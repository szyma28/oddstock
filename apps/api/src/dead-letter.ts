import type { KafkaMessage, Producer } from "kafkajs";

export async function sendToDeadLetter(
  producer: Producer,
  sourceTopic: string,
  partition: number,
  message: KafkaMessage,
  reason: string,
) {
  await producer.send({
    topic: `${sourceTopic}.dlq`,
    messages: [{
      key: message.key?.toString(),
      value: JSON.stringify({
        sourceTopic,
        sourcePartition: partition,
        sourceOffset: message.offset,
        reason,
        failedAt: new Date().toISOString(),
        originalValue: message.value?.toString("utf8") ?? null,
      }),
    }],
  });
}
