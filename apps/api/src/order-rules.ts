export type OrderLine = { unitPricePence: number; quantity: number };
export type MockPayment = { status: "APPROVED" | "DECLINED"; reference: string };

export function calculateOrderTotal(lines: OrderLine[]): number {
  if (lines.length === 0) throw new Error("Order must contain at least one item");
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10) {
      throw new Error("Quantity must be between 1 and 10");
    }
    if (!Number.isInteger(line.unitPricePence) || line.unitPricePence < 0) {
      throw new Error("Price must be a non-negative whole number of pence");
    }
  }
  return lines.reduce((sum, line) => sum + line.unitPricePence * line.quantity, 0);
}

// A decline prefix gives the demo a repeatable failure path; this never calls a payment provider.
export function decideMockPayment(orderId: string): MockPayment {
  const status = orderId.startsWith("decline-") ? "DECLINED" : "APPROVED";
  return { status, reference: `mock_${orderId}` };
}
