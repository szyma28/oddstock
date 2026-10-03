import { Kafka, Partitioners } from "kafkajs";

export const kafka = new Kafka({
  clientId: "oddstock",
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:29092").split(","),
  retry: { initialRetryTime: 300, retries: 8 },
});
export const createConsumer = (groupId: string) => kafka.consumer({
  groupId,
  retry: { restartOnFailure: async () => true },
});
export const createProducer = () => kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
