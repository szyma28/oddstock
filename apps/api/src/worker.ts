import "dotenv/config";
import { createProducer, kafka } from "./kafka.js";
import { sendToDeadLetter } from "./dead-letter.js";
import { orderSubmittedSchema, parseKafkaEvent } from "./events.js";
import { decideMockPayment } from "./order-rules.js";

const consumer = kafka.consumer({ groupId: "oddstock-mock-payments-v1" });
const producer = createProducer();
let orderEventsProcessedTotal = 0;
let deadLetteredTotal = 0;
let lastOrderEventAt: string | null = null;

async function main() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "marketplace.orders", fromBeginning: true });
  console.info(JSON.stringify({ event: "mock_payment_worker_ready", topic: "marketplace.orders" }));
  await consumer.run({ eachMessage: async ({ message, partition }) => {
    if (!message.value) return;
    const parsed = parseKafkaEvent(orderSubmittedSchema, message.value);
    if (!parsed.ok) {
      await sendToDeadLetter(producer, "marketplace.orders", partition, message, parsed.reason);
      deadLetteredTotal += 1;
      console.error(JSON.stringify({ event: "order_event_dead_lettered", reason: parsed.reason, partition, offset: message.offset }));
      console.info(JSON.stringify({ event: "worker_metrics", orderEventsProcessedTotal, deadLetteredTotal, lastOrderEventAt }));
      return;
    }
    const submitted = parsed.event;
    const payment = decideMockPayment(submitted.orderId);
    const result = { version: 1, id: `${submitted.id}:payment-result`, type: "MockPaymentProcessed", orderId: submitted.orderId, status: payment.status, reference: payment.reference, totalPence: submitted.totalPence, requestId: submitted.requestId };
    await producer.send({ topic: "marketplace.payment-results", messages: [{ key: submitted.orderId, value: JSON.stringify(result) }] });
    orderEventsProcessedTotal += 1;
    lastOrderEventAt = new Date().toISOString();
    console.info(JSON.stringify({ event: "mock_payment_processed", orderId: submitted.orderId, outcome: payment.status, paymentReference: payment.reference, eventId: submitted.id, requestId: submitted.requestId }));
    console.info(JSON.stringify({ event: "worker_metrics", orderEventsProcessedTotal, deadLetteredTotal, lastOrderEventAt }));
  } });
}

async function shutdown() {
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((error) => { console.error("payment_worker_failed", error); process.exit(1); });
