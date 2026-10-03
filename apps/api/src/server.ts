import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { products } from "./catalog.js";
import { db } from "./db.js";
import { sendToDeadLetter } from "./dead-letter.js";
import { orderSubmittedSchema, parseKafkaEvent, paymentResultSchema } from "./events.js";
import { createConsumer, createProducer } from "./kafka.js";
import { calculateOrderTotal } from "./order-rules.js";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const cookieName = "oddstock_session";
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 7;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
let kafkaPublisher: ReturnType<typeof createProducer> | undefined;
let kafkaConsumer: Awaited<ReturnType<typeof startPaymentResultConsumer>> | undefined;
let paymentResultsConsumerReady = false;
let outboxPublishInFlight = false;
const metrics = {
  outboxPublishedTotal: 0,
  outboxPublishFailureTotal: 0,
  paymentResultsProcessedTotal: 0,
  paymentResultsDuplicateTotal: 0,
  paymentResultsDeadLetteredTotal: 0,
  lastPaymentResultAt: null as string | null,
};

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Please wait a little and try again." } });
app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.get("origin") !== webOrigin) {
    return res.status(403).json({ error: "Request origin not allowed" });
  }
  next();
});

type AuthedRequest = Request & { userId?: string };
async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies[cookieName] as string | undefined;
    if (!token) return res.status(401).json({ error: "Sign in to continue" });
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, select: { userId: true, expiresAt: true } });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await db.session.delete({ where: { tokenHash: hashToken(token) } });
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    req.userId = session.userId;
    next();
  } catch (error) { next(error); }
}

const registerSchema = z.object({ name: z.string().trim().min(2).max(60), email: z.email().trim().toLowerCase(), password: z.string().min(10).max(128) });
const loginSchema = z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(1).max(128) });
const issueSession = async (userId: string, res: Response) => {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + sessionLifetimeMs) } });
  res.cookie(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: sessionLifetimeMs });
};

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "oddstock-api" }));
app.get("/api/ready", async (_req, res) => {
  let databaseReady = false;
  try { await db.$queryRaw`SELECT 1`; databaseReady = true; } catch { /* readiness response explains the dependency state */ }
  const ready = databaseReady && paymentResultsConsumerReady;
  res.status(ready ? 200 : 503).json({ ready, checks: { database: databaseReady, paymentResultsConsumer: paymentResultsConsumerReady } });
});
app.get("/api/metrics", async (_req, res) => {
  try {
    const [pending, oldestPending, orderStatuses] = await Promise.all([
      db.outboxEvent.count({ where: { topic: "marketplace.orders", publishedAt: null } }),
      db.outboxEvent.findFirst({ where: { topic: "marketplace.orders", publishedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    res.json({
      service: "oddstock-api",
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: { paymentResultsConsumerReady },
      outbox: { pending, oldestPendingAt: oldestPending?.createdAt.toISOString() ?? null, publishedTotal: metrics.outboxPublishedTotal, publishFailureTotal: metrics.outboxPublishFailureTotal },
      kafka: {
        paymentResultsProcessedTotal: metrics.paymentResultsProcessedTotal,
        paymentResultsDuplicateTotal: metrics.paymentResultsDuplicateTotal,
        paymentResultsDeadLetteredTotal: metrics.paymentResultsDeadLetteredTotal,
        lastPaymentResultAt: metrics.lastPaymentResultAt,
      },
      ordersByStatus: Object.fromEntries(orderStatuses.map(({ status, _count }) => [status, _count._all])),
    });
  } catch {
    res.status(503).json({ error: "Metrics are temporarily unavailable" });
  }
});

app.get("/api/products", async (_req, res, next) => {
  try {
    await Promise.all(products.map((product) => db.product.upsert({ where: { id: product.id }, update: product, create: product })));
    res.json(products);
  } catch (error) { next(error); }
});

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await db.user.create({ data: { name: input.name, email: input.email, passwordHash }, select: { id: true, name: true, email: true } });
    await issueSession(user.id, res);
    res.status(201).json({ user });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return res.status(409).json({ error: "An account with this email already exists" });
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) return res.status(401).json({ error: "Email or password is incorrect" });
    await issueSession(user.id, res);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", requireUser, async (req: AuthedRequest, res, next) => {
  try { res.json({ user: await db.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true } }) }); }
  catch (error) { next(error); }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = req.cookies[cookieName] as string | undefined;
    if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
    res.status(204).end();
  } catch (error) { next(error); }
});

const orderSchema = z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10) })).min(1).max(20), demoOutcome: z.enum(["APPROVE", "DECLINE"]).default("APPROVE") });
app.post("/api/orders", requireUser, async (req: AuthedRequest, res, next) => {
  try {
    if (!paymentResultsConsumerReady) return res.status(503).json({ error: "Order processing is starting. Please try again shortly." });
    const input = orderSchema.parse(req.body);
    const requested = new Map<string, number>();
    for (const line of input.items) {
      const combinedQuantity = (requested.get(line.productId) ?? 0) + line.quantity;
      if (combinedQuantity > 10) return res.status(400).json({ error: "You can order up to 10 of each product" });
      requested.set(line.productId, combinedQuantity);
    }
    const ids = [...requested.keys()];
    const catalogue = await db.product.findMany({ where: { id: { in: ids } } });
    if (catalogue.length !== ids.length) return res.status(400).json({ error: "One or more products are no longer available" });
    const lines = catalogue.map((product) => ({ ...product, quantity: requested.get(product.id)! }));
    const totalPence = calculateOrderTotal(lines.map((line) => ({ unitPricePence: line.pricePence, quantity: line.quantity })));
    const orderId = `${input.demoOutcome === "DECLINE" ? "decline-" : ""}${randomUUID()}`;
    const eventId = randomUUID();
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({ data: {
        id: orderId, userId: req.userId!, totalPence,
        items: { create: lines.map((line) => ({ productId: line.id, productName: line.name, unitPricePence: line.pricePence, quantity: line.quantity })) },
      }, include: { items: true } });
      await tx.outboxEvent.create({ data: { id: eventId, topic: "marketplace.orders", eventType: "OrderSubmitted", payload: { eventId, version: 1, orderId, totalPence, requestId: (req as AuthedRequest & { requestId?: string }).requestId, createdAt: created.createdAt.toISOString() } } });
      return created;
    });
    res.status(202).json({ order, message: "Order received; mock payment is processing." });
  } catch (error) { next(error); }
});

app.get("/api/orders", requireUser, async (req: AuthedRequest, res, next) => {
  try { res.json(await db.order.findMany({ where: { userId: req.userId }, include: { items: true }, orderBy: { createdAt: "desc" } })); }
  catch (error) { next(error); }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Please check the details and try again", fields: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
  console.error(JSON.stringify({ event: "request_failed", errorType: error instanceof Error ? error.name : "UnknownError" }));
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function publishOutboxBatch() {
  if (!kafkaPublisher || outboxPublishInFlight) return;
  outboxPublishInFlight = true;
  try {
    const events = await db.outboxEvent.findMany({ where: { publishedAt: null, topic: "marketplace.orders" }, orderBy: { createdAt: "asc" }, take: 50 });
    for (const event of events) {
      const payload = event.payload as { orderId: string; requestId?: string };
      await kafkaPublisher.send({ topic: event.topic, messages: [{ key: payload.orderId, value: JSON.stringify({ id: event.id, type: event.eventType, ...event.payload as object }) }] });
      await db.outboxEvent.updateMany({ where: { id: event.id, publishedAt: null }, data: { publishedAt: new Date() } });
      metrics.outboxPublishedTotal += 1;
      console.info(JSON.stringify({ event: "kafka_published", topic: event.topic, eventId: event.id, orderId: payload.orderId, requestId: payload.requestId }));
    }
  } finally { outboxPublishInFlight = false; }
}

async function startPaymentResultConsumer(producer: ReturnType<typeof createProducer>) {
  const consumer = createConsumer("oddstock-api-payment-results-v1");
  consumer.on(consumer.events.GROUP_JOIN, () => {
    paymentResultsConsumerReady = true;
    console.info(JSON.stringify({ event: "kafka_consumer_ready", topic: "marketplace.payment-results" }));
  });
  consumer.on(consumer.events.CRASH, ({ payload }) => {
    paymentResultsConsumerReady = false;
    console.error(JSON.stringify({ event: "kafka_consumer_crashed", restart: payload.restart, message: payload.error.message }));
  });
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: "marketplace.payment-results", fromBeginning: false });
    await consumer.run({ eachMessage: async ({ message, partition }) => {
    if (!message.value) return;
    const parsed = parseKafkaEvent(paymentResultSchema, message.value);
    if (!parsed.ok) {
      await sendToDeadLetter(producer, "marketplace.payment-results", partition, message, parsed.reason);
      metrics.paymentResultsDeadLetteredTotal += 1;
      console.error(JSON.stringify({ event: "payment_result_dead_lettered", reason: parsed.reason, partition, offset: message.offset }));
      return;
    }
    const event = parsed.event;
    try {
      await db.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { eventId: event.id } });
        await tx.order.update({ where: { id: event.orderId }, data: { status: event.status === "APPROVED" ? "PAID" : "PAYMENT_DECLINED" } });
      });
      metrics.paymentResultsProcessedTotal += 1;
      metrics.lastPaymentResultAt = new Date().toISOString();
      console.info(JSON.stringify({ event: "order_status_updated", orderId: event.orderId, status: event.status, eventId: event.id, requestId: (event as { requestId?: string }).requestId }));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        metrics.paymentResultsDuplicateTotal += 1;
        metrics.lastPaymentResultAt = new Date().toISOString();
        console.info(JSON.stringify({ event: "duplicate_payment_result_ignored", eventId: event.id }));
        return;
      }
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        await sendToDeadLetter(producer, "marketplace.payment-results", partition, message, "order_not_found");
        metrics.paymentResultsDeadLetteredTotal += 1;
        console.error(JSON.stringify({ event: "payment_result_dead_lettered", reason: "order_not_found", orderId: event.orderId, eventId: event.id, partition, offset: message.offset }));
        return;
      }
      throw error;
    }
    } });
    return consumer;
  } catch (error) {
    await consumer.disconnect().catch(() => undefined);
    throw error;
  }
}

const httpServer = app.listen(port, () => console.info(`Oddstock API listening on http://localhost:${port}`));
if (process.env.KAFKA_DISABLED !== "true") {
  const connectConsumer = async () => {
    while (!paymentResultsConsumerReady) {
      const producer = createProducer();
      try {
        await producer.connect();
        kafkaConsumer = await startPaymentResultConsumer(producer);
        kafkaPublisher = producer;
      } catch (error) {
        await producer.disconnect().catch(() => undefined);
        console.error(JSON.stringify({ event: "kafka_consumer_unavailable", message: error instanceof Error ? error.message : String(error) }));
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };
  void connectConsumer();
  const publisherTimer = setInterval(() => {
    if (paymentResultsConsumerReady) publishOutboxBatch().catch((error) => {
      metrics.outboxPublishFailureTotal += 1;
      console.error(JSON.stringify({ event: "outbox_publish_failed", message: error instanceof Error ? error.message : String(error) }));
    });
  }, 1500);
  publisherTimer.unref();
}

async function shutdown() {
  httpServer.close();
  if (kafkaConsumer) await kafkaConsumer.disconnect();
  if (kafkaPublisher) await kafkaPublisher.disconnect();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
