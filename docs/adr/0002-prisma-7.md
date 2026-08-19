# 2. Prisma 7 with a driver adapter

**Status:** accepted

## Context

An ORM was needed with real migrations and strong types. Prisma is the
best-documented option in this ecosystem, which matters when the people
maintaining this later may include AI assistants trained on public code.

## Decision

Prisma 7, using the `prisma-client` generator and the node-postgres driver
adapter rather than the historical Rust query engine.

## Reasoning

Prisma 7 removed the Rust engine from the runtime path. That means:

- no engine binary to download at install time, in CI, or in a container
- the connection is a normal `pg` pool, so pool behaviour is inspectable and
  tunable with existing knowledge
- generation works in restricted network environments

The cost is that the generated client's row types are named `<Model>Model`
rather than `<Model>`. `src/lib/types.ts` aliases them back to plain domain
names, so application code reads `Client`, not `ClientModel` — and if the
generator's conventions change again, that one file absorbs it.

## Consequences

- The connection URL lives in `prisma.config.ts` for the CLI and is passed to
  the adapter in code, rather than sitting in `schema.prisma`.
- Every database-derived type is imported from `@/lib/types`, never from the
  generated directory. Enforced by convention.
- Prisma 7 is newer than 5.x, so there is less community material about it.
  The API surface used here — findMany, transactions, groupBy, raw queries — is
  unchanged from previous versions.
