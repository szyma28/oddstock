# Oddstock — marketplace + Kafka order flow

Oddstock is a fictional, brand-new marketplace portfolio project. Its listings are synthetic, and checkout is a deterministic mock: it does not accept card details, contact a payment provider, or move money.

## What it demonstrates

- A React storefront with product search, category filtering, a local cart, sign-in/register and order status.
- An Express/TypeScript API with input validation, Argon2id password hashing, random opaque server-side sessions stored as SHA-256 hashes, HttpOnly/SameSite cookies, origin checks, login rate limiting and per-user order access.
- PostgreSQL persistence with Prisma. Prices are looked up on the server; the browser never supplies a trusted total.
- A transactional outbox: an order and its `OrderSubmitted` event are committed together. A relay publishes that event to Kafka, so an API restart between the DB commit and publish does not silently lose the order event.
- A separate Kafka consumer simulates payment and publishes a result. The API consumes that result and updates the order. Event IDs make result handling idempotent; the order ID is used as the Kafka key to keep that order's messages on one partition.
- Versioned Zod schemas validate both event types at runtime. Invalid events and payment results for missing orders are copied to their topic's dead-letter queue with source topic, partition, offset and reason, so a bad message does not hold up later orders.
- Structured JSON logs around publish/consume/status transitions, plus repeatable APPROVE and DECLINE demo paths.
- A generated request ID follows an order into both Kafka events and worker/API logs, making the asynchronous path easier to follow when debugging.
- `/api/health` reports process liveness, `/api/ready` checks the database and current payment-result consumer membership, and `/api/metrics` reports the outbox backlog, order counts and process-local Kafka counters.

## Start locally

Prerequisites: Node.js 20.19+ or 22.12+, pnpm 10+, and Docker Desktop with Compose.

1. In a terminal, enter this folder and install packages:

   ```sh
   pnpm install
   cp .env.example apps/api/.env
   ```

2. Start PostgreSQL and the single-node local Kafka broker (Postgres is exposed on port 55432 to avoid clashing with a local Postgres install):

   ```sh
   pnpm infra:up
   ```

3. Create the local database tables, then run API + web in one terminal:

   ```sh
   pnpm --filter @oddstock/api db:push
   pnpm dev
   ```

4. In a second terminal start the mock payment consumer:

   ```sh
   pnpm dev:worker
   ```

Open http://localhost:5173. Create a demo account with any email and a password of at least 10 characters. Add a product, open the bag and place a demo order. Leave the payment decline checkbox off for an approval, or turn it on to show the declined path. The order status refreshes while the Kafka consumer is running.

To stop the local data services, run `pnpm infra:down`. Named Postgres and Kafka volumes keep demo data and messages between container restarts. Remove them only if you intentionally want to reset the local demo (`sh infra/docker-compose.sh down -v`).

## Event flow

```text
Browser → API → PostgreSQL transaction (Order + OutboxEvent)
                        ↓
             outbox relay → Kafka: marketplace.orders → marketplace.orders.dlq
                                  ↓                       invalid events
                    mock payment consumer
                                  ↓
          Kafka: marketplace.payment-results → marketplace.payment-results.dlq
                                  ↓                       invalid events
                    API consumer → Order status
```

## Useful checks

```sh
pnpm test
pnpm typecheck
pnpm build
```

GitHub Actions runs these checks on pushes and pull requests, then starts PostgreSQL and Kafka and runs the integration suite. The recovery test briefly stops and restarts this project's Kafka container to verify that an order remains in the outbox and is processed after the broker returns.

The automated test suite covers price calculation from server-owned values, quantity/empty-order rules and predictable mock payment outcomes. The Kafka/Postgres integration path requires Docker and is intentionally kept separate from those fast unit tests.

With PostgreSQL and Kafka running, the API and web app started with `pnpm dev`, and the worker running in a second terminal with `pnpm dev:worker`, run:

```sh
pnpm test:integration
```

This exercises approved and declined order flows, duplicate payment-result delivery, malformed-event dead-lettering, readiness and metrics against the local services. It creates a temporary test account and orders, then removes their database records. Integration tests are opt-in and are skipped by the regular `pnpm test` command.

## Security and scope notes

This is a learning/demo app, not a production commerce system. Do not enter real personal information or payment details. It has local-only Compose credentials, no real payment provider, no email verification, no production secret-management, and no multi-instance session store hardening. The local Compose broker is a single node, and the outbox relay is intended to run as one API instance. The auth choices are examples for a portfolio discussion, not a security certification. Production deployment would also require a TLS-only domain, managed secrets, a deployment-appropriate CSRF strategy, operational monitoring/alerts, backup and restore testing, and a provider-hosted payment flow.

The `deepmerge-ts` pnpm override replaces Prisma's pinned 7.1.5 copy with patched 8.0.2. Prisma uses this merger only while loading developer-owned config; request data never reaches it. The override can be removed once Prisma ships with a patched dependency.

The project is original and does not use Miribeth names, logos, slogans or client assets.
