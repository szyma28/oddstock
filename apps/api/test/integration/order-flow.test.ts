import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kafka, createProducer } from "../../src/kafka.js";
import { db } from "../../src/db.js";

const enabled = process.env.RUN_KAFKA_INTEGRATION_TESTS === "1";
const api = process.env.INTEGRATION_API_URL ?? "http://localhost:4000/api";
const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const composeFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", "infra/compose.yml");
const compose = (...args: string[]) => execFileSync("docker", ["compose", "-f", composeFile, ...args], { stdio: "pipe" });
const email = `kafka-test-${randomUUID()}@example.test`;
let cookie = "";
let userId = "";
const orderIds: string[] = [];
const outboxIds: string[] = [];
const resultEventIds: string[] = [];
const requestHeaders = () => ({ Cookie: cookie, Origin: origin, "Content-Type": "application/json" });

async function waitForStatus(orderId: string, expected: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${api}/orders`, { headers: requestHeaders() });
      if (response.ok) {
        const orders = await response.json() as { id: string; status: string }[];
        if (orders.find((order) => order.id === orderId)?.status === expected) return;
      }
    } catch {
      // Brief connection resets are expected while the broker and consumers reconnect.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Order ${orderId} did not reach ${expected} within 20 seconds`);
}

async function createOrder(demoOutcome: "APPROVE" | "DECLINE") {
  const response = await fetch(`${api}/orders`, {
    method: "POST", headers: requestHeaders(),
    body: JSON.stringify({ items: [{ productId: "find-01", quantity: 1 }], demoOutcome }),
  });
  expect(response.status).toBe(202);
  const body = await response.json() as { order: { id: string; totalPence: number } };
  orderIds.push(body.order.id);
  const outbox = await db.outboxEvent.findFirst({ where: { payload: { path: ["orderId"], equals: body.order.id } } });
  expect(outbox).not.toBeNull();
  outboxIds.push(outbox!.id);
  resultEventIds.push(`${outbox!.id}:payment-result`);
  return { ...body.order, outboxId: outbox!.id };
}

describe.skipIf(!enabled)("Kafka order-flow integration", () => {
  beforeAll(async () => {
    const readiness = await fetch(`${api}/ready`);
    if (!readiness.ok) throw new Error(`API is not ready (${readiness.status}); start Postgres, Kafka, API and worker first.`);
    await fetch(`${api}/products`);
    const response = await fetch(`${api}/auth/register`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kafka Integration Test", email, password: "integration-test-passphrase" }),
    });
    if (!response.ok) throw new Error(`Could not create integration test account (${response.status})`);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    const body = await response.json() as { user: { id: string } };
    userId = body.user.id;
    if (!cookie) throw new Error("The API did not issue a session cookie");
  }, 30_000);

  afterAll(async () => {
    if (orderIds.length) {
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (resultEventIds.length) await db.processedEvent.deleteMany({ where: { eventId: { in: resultEventIds } } });
    if (outboxIds.length) await db.outboxEvent.deleteMany({ where: { id: { in: outboxIds } } });
    if (userId) {
      await db.session.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
  }, 30_000);

  it("sends approved and declined orders through Kafka and updates their status", async () => {
    const approved = await createOrder("APPROVE");
    const declined = await createOrder("DECLINE");
    await Promise.all([waitForStatus(approved.id, "PAID"), waitForStatus(declined.id, "PAYMENT_DECLINED")]);
    const published = await db.outboxEvent.findMany({ where: { id: { in: [approved.outboxId, declined.outboxId] } } });
    expect(published).toHaveLength(2);
    expect(published.every((event) => event.publishedAt !== null)).toBe(true);
  }, 45_000);

  it("keeps an order in the outbox while Kafka is down and processes it after recovery", async () => {
    compose("stop", "kafka");
    let order: Awaited<ReturnType<typeof createOrder>> | undefined;
    try {
      order = await createOrder("APPROVE");
      const pending = await db.outboxEvent.findUnique({ where: { id: order.outboxId } });
      expect(pending?.publishedAt).toBeNull();
    } finally {
      compose("up", "-d", "--wait", "kafka");
    }

    await waitForStatus(order!.id, "PAID", 60_000);
    const recovered = await db.outboxEvent.findUnique({ where: { id: order!.outboxId } });
    expect(recovered?.publishedAt).not.toBeNull();
  }, 90_000);

  it("records a repeated payment-result event only once", async () => {
    const order = await createOrder("APPROVE");
    await waitForStatus(order.id, "PAID");
    const before = await fetch(`${api}/metrics`).then((response) => response.json()) as { kafka: { paymentResultsDuplicateTotal: number } };
    const event = {
      version: 1, id: `${order.outboxId}:payment-result`, type: "MockPaymentProcessed",
      orderId: order.id, status: "APPROVED", reference: `mock_${order.id}`,
      totalPence: order.totalPence,
    };
    const producer = createProducer();
    await producer.connect();
    try {
      await producer.send({ topic: "marketplace.payment-results", messages: [
        { key: order.id, value: JSON.stringify(event) },
        { key: order.id, value: JSON.stringify(event) },
      ] });
    } finally { await producer.disconnect(); }
    let duplicateCount = before.kafka.paymentResultsDuplicateTotal;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const metrics = await fetch(`${api}/metrics`).then((response) => response.json()) as { kafka: { paymentResultsDuplicateTotal: number } };
      duplicateCount = metrics.kafka.paymentResultsDuplicateTotal;
      if (duplicateCount >= before.kafka.paymentResultsDuplicateTotal + 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const processed = await db.processedEvent.count({ where: { eventId: event.id } });
    expect(processed).toBe(1);
    expect(duplicateCount).toBeGreaterThanOrEqual(before.kafka.paymentResultsDuplicateTotal + 2);
  }, 30_000);

  it("sends malformed order messages to the orders dead-letter topic", async () => {
    const key = `bad-event-${randomUUID()}`;
    const consumer = kafka.consumer({ groupId: `oddstock-test-dlq-${randomUUID()}` });
    await consumer.connect();
    await consumer.subscribe({ topic: "marketplace.orders.dlq", fromBeginning: true });
    let resolveMessage!: (message: { key?: string; value?: string }) => void;
    const received = new Promise<{ key?: string; value?: string }>((resolve) => { resolveMessage = resolve; });
    await consumer.run({ eachMessage: async ({ message }) => {
      if (message.key?.toString() === key) resolveMessage({ key: message.key?.toString(), value: message.value?.toString() });
    } });
    const producer = createProducer();
    await producer.connect();
    try {
      await producer.send({ topic: "marketplace.orders", messages: [{ key, value: "{not-json" }] });
      const deadLetter = await Promise.race([
        received,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for the dead-letter event")), 10_000)),
      ]);
      const payload = JSON.parse(deadLetter.value ?? "{}") as { sourceTopic: string; reason: string; originalValue: string };
      expect(deadLetter.key).toBe(key);
      expect(payload).toMatchObject({ sourceTopic: "marketplace.orders", reason: "invalid_json", originalValue: "{not-json" });
    } finally {
      await producer.disconnect();
      await consumer.stop();
      await consumer.disconnect();
    }
  }, 30_000);

  it("reports readiness and useful flow metrics", async () => {
    const readiness = await fetch(`${api}/ready`);
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({ ready: true, checks: { database: true, paymentResultsConsumer: true } });
    const response = await fetch(`${api}/metrics`);
    expect(response.status).toBe(200);
    const metrics = await response.json() as { kafka: Record<string, unknown>; outbox: { pending: number; oldestPendingAt: string | null } };
    expect(metrics.kafka).toMatchObject({
      paymentResultsProcessedTotal: expect.any(Number),
      paymentResultsDuplicateTotal: expect.any(Number),
      paymentResultsDeadLetteredTotal: expect.any(Number),
    });
    expect(typeof metrics.outbox.pending).toBe("number");
    expect(metrics.outbox.oldestPendingAt === null || typeof metrics.outbox.oldestPendingAt === "string").toBe(true);
  }, 10_000);
});
