import { describe, expect, it } from "vitest";
import { orderSubmittedSchema, parseKafkaEvent, paymentResultSchema } from "../src/events.js";

describe("Kafka event validation", () => {
  it("accepts a versioned order event", () => {
    const event = {
      version: 1,
      id: "event-1",
      type: "OrderSubmitted",
      orderId: "order-1",
      totalPence: 1250,
      requestId: "f3bd780f-ec17-4b24-a0e2-e0181c64af70",
      createdAt: "2026-10-03T12:00:00.000Z",
    };

    expect(parseKafkaEvent(orderSubmittedSchema, JSON.stringify(event))).toEqual({ ok: true, event });
  });

  it("rejects malformed JSON and unsupported event versions", () => {
    expect(parseKafkaEvent(orderSubmittedSchema, "{" )).toEqual({ ok: false, reason: "invalid_json" });
    expect(parseKafkaEvent(orderSubmittedSchema, JSON.stringify({ version: 2 }))).toEqual({ ok: false, reason: "invalid_event" });
  });

  it("rejects a payment result with an unknown status", () => {
    const event = { version: 1, id: "result-1", type: "MockPaymentProcessed", orderId: "order-1", status: "MAYBE", reference: "mock", totalPence: 100 };
    expect(parseKafkaEvent(paymentResultSchema, JSON.stringify(event))).toEqual({ ok: false, reason: "invalid_event" });
  });
});
