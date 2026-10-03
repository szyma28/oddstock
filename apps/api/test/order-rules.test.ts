import { describe, expect, it } from "vitest";
import { calculateOrderTotal, decideMockPayment } from "../src/order-rules.js";

describe("order rules", () => {
  it("calculates totals from trusted catalogue prices, not client totals", () => {
    expect(calculateOrderTotal([
      { unitPricePence: 1250, quantity: 2 },
      { unitPricePence: 499, quantity: 1 },
    ])).toBe(2999);
  });

  it("rejects empty orders and invalid quantities", () => {
    expect(() => calculateOrderTotal([])).toThrow("Order must contain at least one item");
    expect(() => calculateOrderTotal([{ unitPricePence: 500, quantity: 0 }])).toThrow("Quantity must be between 1 and 10");
  });

  it("produces stable mock outcomes without pretending to process real money", () => {
    expect(decideMockPayment("demo-order-123")).toEqual({ status: "APPROVED", reference: "mock_demo-order-123" });
    expect(decideMockPayment("decline-demo-123").status).toBe("DECLINED");
  });
});
