import { z } from "zod";

export const orderSubmittedSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(200),
  type: z.literal("OrderSubmitted"),
  orderId: z.string().min(1),
  totalPence: z.number().int().nonnegative(),
  requestId: z.uuid().optional(),
  createdAt: z.iso.datetime(),
});

export const paymentResultSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(220),
  type: z.literal("MockPaymentProcessed"),
  orderId: z.string().min(1),
  status: z.enum(["APPROVED", "DECLINED"]),
  reference: z.string().min(1).max(240),
  totalPence: z.number().int().nonnegative(),
  requestId: z.uuid().optional(),
});

export function parseKafkaEvent<T>(schema: z.ZodType<T>, raw: Buffer | string): { ok: true; event: T } | { ok: false; reason: "invalid_json" | "invalid_event" } {
  let value: unknown;
  try { value = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")); }
  catch { return { ok: false, reason: "invalid_json" }; }
  const result = schema.safeParse(value);
  return result.success ? { ok: true, event: result.data } : { ok: false, reason: "invalid_event" };
}
