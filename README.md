# Oddstock

A little shop for useful things, odd finds and objects with questionable backstories. Checkout runs through Kafka; no real payments are taken.

## Run locally

Requires Node.js 20.19+ or 22.12+, pnpm 10+ and Docker Desktop.

```sh
pnpm install
cp .env.example apps/api/.env
pnpm infra:up
pnpm --filter @oddstock/api db:push
pnpm dev
```

In another terminal, run `pnpm dev:worker`, then open [localhost:5173](http://localhost:5173). Create an account with a made-up email and password. Checkout lets you show either an approved or declined order.

To stop the local services, run `pnpm infra:down`.

## Stack

React, TypeScript, Express, PostgreSQL, Prisma and Kafka. Orders are saved with an outbox record before they’re sent to Kafka; a worker returns a mock payment result and the API updates the order. Invalid events go to a dead-letter topic.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test:integration` runs the Kafka/Postgres flow and needs the local services running. GitHub Actions runs it on pushes and pull requests.

This is a learning project, not a production shop. Use made-up account details; there is no real payment service. The credentials in the local Compose setup are for development only.
