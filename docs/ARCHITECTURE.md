# Architecture

This document explains how the code is arranged, why it is arranged that way,
and — most usefully — **where to make a given change**.

---

## The one rule

Dependencies point in one direction:

```
app/  →  server/  →  core/  →  integrations/  →  lib/
 UI      actions     logic      providers        utilities
```

- `core/` never imports from `app/` or `ui/`.
- `integrations/` never imports from `core/`.
- `lib/` imports from nothing but itself.

Everything else follows from this. A UI redesign cannot break the WhatsApp
integration, because the WhatsApp integration has never heard of the UI.

---

## Layers

### `lib/` — cross-cutting utilities

`env.ts` is the only place `process.env` is read. It validates at boot and
fails loudly with a readable message rather than producing `undefined` three
layers down. `db.ts` is the single Prisma client. `errors.ts` defines typed
errors that `api.ts` and `server/action-helpers.ts` map to HTTP statuses and
form errors in one place. `rbac.ts` holds the permission model.

### `integrations/` — the outside world

Four provider families, each an interface plus implementations:

| Family | Real | Offline |
|---|---|---|
| `whatsapp/` | 360dialog | `mock` — logs sends, parses the same payloads |
| `ai/` | OpenAI | `mock` — deterministic keyword classifier |
| `storage/` | S3 | `local` — filesystem with signed-URL equivalents |
| `queue/` | SQS | `database` (Postgres) and `inline` (dev) |

Each family exposes a single `get*()` factory that reads the configured
provider. Nothing else in the codebase knows which one is active.

**The offline implementations are not stubs.** They are complete enough that
the entire application — workflows, checklists, verification queues, analytics
— can be developed, demonstrated and tested with no credentials and no spend.
That is what makes it realistic to work on the CRM before the WABA number is
approved.

**To replace a provider:** add a class implementing the interface, add a case
to the factory, add its config to `env.ts`. Nothing else changes.

### `core/` — business logic

Framework-free TypeScript. Every service takes an `Actor` (the person or the
system) rather than reading a session, which is why the same functions serve
the web app, the API and the background worker, and why they are testable
without a request.

Each module owns one concern and exposes functions, not classes:

- **`clients/`** — the centre of the CRM. Also `provenance.ts`, which records
  where every field value came from.
- **`pipeline/`** — all stage movement flows through `moveClientToStage`, which
  is what guarantees history, timeline, audit and time-in-stage are always
  written together.
- **`messaging/`** — `inbound.ts` is the reliability-critical path; see below.
- **`ai/`** — orchestration and the suggestion queue. Calls a provider, stores
  the result, hands off to workflows. Never applies anything itself.
- **`workflows/`** — `rules.ts` (pure, readable, testable) and `engine.ts`
  (decides apply vs suggest). The most important file in the system.
- **`documents/`** — storage, the per-client checklist, and `apply.ts`, which
  enforces "AI never overwrites an existing value".

### `server/` — the bridge

Thin server actions: resolve the actor, call a core service, revalidate the
affected routes, convert errors into something a form can render. No business
logic. If an action is longer than about fifteen lines, the logic belongs in
`core/`.

### `app/` and `ui/`

Routes and presentation. `ui/components/primitives.tsx` plus the tokens in
`globals.css` are the design system; screens compose them. No component imports
from `core/` — pages fetch data server-side and pass plain props down.

---

## Two flows worth understanding

### Inbound WhatsApp message

```
360dialog
   │  POST /api/webhooks/whatsapp?token=…
   ▼
route.ts        verify token → verify signature → parse
   ▼
inbound.ts      1. WebhookEvent row      ← unique(provider, externalId)
                2. find/create client by phone
                3. Message row + attachments  ← unique(channel, externalId)
                4. bump denormalised counters
                5. enqueue jobs
   ▼            ────────── 200 OK returned here ──────────
worker
   ├─ download_media      → storeDocument → enqueue process_document
   ├─ process_document    → AI extraction → apply/suggest → re-check checklist
   └─ process_message     → AI understanding → workflow engine
```

The ordering is deliberate and load-bearing. **The message is committed to
Postgres before anything interprets it.** An OpenAI outage, a slow S3, or a bug
in a rule cannot cost a customer's message — the worst case is that processing
is retried later against data that is already safe.

Duplicate delivery is handled by two unique constraints, not by application
logic that could race: `WebhookEvent(provider, externalId)` and
`Message(channel, externalId)`. Providers retry routinely; this is not an edge
case.

### AI suggestion → action

```
message → AI provider → MessageAnalysis (intent + confidence, stored)
                              │
                              ▼
                    workflow rules (pure)
                              │  proposed actions
                              ▼
                       workflow engine
                    ┌─────────┴──────────┐
              apply directly        AiSuggestion row
        (labels, tasks, follow-ups,   (stage moves below
         confident reversible          threshold, terminal
         stage moves)                  moves, field overwrites)
                                              │
                                        person accepts
                                              │
                                              ▼
                                    the same service a
                                    human would have used
```

Accepting a suggestion calls exactly the same function the manual UI calls.
There is no second, divergent automation path that could drift.

---

## Where to make a change

| I want to… | Edit |
|---|---|
| Change what happens when a customer says something | `src/core/workflows/rules.ts` |
| Change whether an action auto-applies or waits for a human | `src/core/workflows/engine.ts` |
| Add an intent AI can recognise | `src/integrations/ai/vocabulary.ts`, then a rule |
| Add a field AI reads from a document | `EXTRACTORS` in `vocabulary.ts` |
| Add a client/driver/vehicle field | `prisma/schema.prisma` + `core/clients/schemas.ts` + the field list in the client form — or add a **custom field** in Settings and write no code |
| Add a pipeline stage, insurer, document type, task type | Nothing — Settings |
| Change a confidence threshold or follow-up window | Nothing — Settings |
| Swap WhatsApp / AI / storage / queue provider | One new file in `src/integrations/<family>/` |
| Redesign the interface | `src/ui/` and `src/app/` only |
| Add a permission | `src/lib/rbac.ts`, then guard the call site |

---

## Data model notes

**Lookups are rows, not enums.** Pipeline stages, insurers, lead sources, lost
reasons, document types, task types, quote statuses and age groups are all
tables. Enums are reserved for things that are structural to the code and would
need a code change anyway (message direction, job status, provenance source).

**There is no separate Lead entity.** A lead and a client are the same record at
different stages, because in this business a lead becomes a client without
changing identity — and splitting them would mean migrating conversations and
documents at the exact moment staff least want friction.

**Denormalised counters** (`Client.unreadCount`, `lastInboundAt`,
`needsAttention`) exist so the dashboard and list screens are single indexed
queries. They are written only by the services that own them.

**`customFields Json`** on the major entities lets an administrator add a field
through Settings with no migration. If a custom field becomes load-bearing,
promote it to a real column — it will be faster to filter and report on.

**Field provenance** is a first-class table. The CRM can always answer "where
did this value come from, and has a human checked it?", which is what makes it
safe to let a model read a driver's licence at all.

---

## Testing

`tests/workflows.test.ts` is the suite that matters most: the rules decide what
happens to a client's file, and a mistake there is invisible until a customer is
annoyed or a lead is lost. The rules are pure functions specifically so they can
be tested exhaustively without a database — including the assertion that no rule
can ever produce a binding, pricing or underwriting action.

The other suites cover permissions (including the negative cases — agents cannot
bind, assistants cannot download documents), webhook parsing against real-shaped
and deliberately malformed payloads, audit redaction, and the small helpers that
are easy to get subtly wrong (phone normalisation, age calculation).

---

## Deliberate non-goals

- **No microservices.** One Next.js app and one worker process. At brokerage
  volume, splitting this would add operational cost and buy nothing.
- **No separate analytics warehouse.** Reports query the operational tables, so
  the numbers on screen are the numbers in the database with no staleness to
  explain. If volume ever makes it slow, the fix is a materialised view behind
  the same function signatures.
- **No Redis.** The one thing that wanted a cache — rate limiting — is handled
  in-process, which is correct for a single-instance deployment and clearly
  marked for replacement if that changes.
- **No full-text search engine.** Indexed `contains` matching across name,
  phone, email, licence, VIN, plate, policy and insurer is fast and predictable
  at this scale, and is one less thing to operate.

Each of these becomes wrong at a scale this brokerage is unlikely to reach soon.
They are documented here so the reasoning is available when it does.
