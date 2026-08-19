# Insurance CRM

A WhatsApp-first CRM for an insurance brokerage. Leads arrive on WhatsApp, the
CRM reads them, works out what is missing, chases it, and keeps the pipeline,
quotes, documents and follow-ups in one place.

The design rule that shapes everything else: **AI describes, business rules
decide, people approve anything that matters.** Nothing in this system binds a
policy, prices a risk, decides eligibility, or overwrites a client's details on
a model's say-so.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    At minimum set DATABASE_URL and NEXTAUTH_SECRET (openssl rand -base64 32).
#    Leave the provider settings on mock/local to run without any credentials.

# 3. Database
npm run db:generate         # generate the Prisma client
npm run db:deploy           # apply migrations
npm run db:seed             # reference data + demo clients

# 4. Run
npm run dev                 # http://localhost:3000
```

Seeded sign-in (change these immediately):

| Email | Role |
|---|---|
| `admin@brokerage.test` | Administrator |
| `broker@brokerage.test` | Broker |
| `agent@brokerage.test` | Agent |
| `assistant@brokerage.test` | Assistant |

Password for all four: `ChangeMeAfterSetup2026` (override with `SEED_PASSWORD`).

### Try the WhatsApp flow without a WhatsApp number

```bash
node scripts/simulate-whatsapp.mjs "+14165550199" "Hi, I need car insurance"
node scripts/simulate-whatsapp.mjs "+14165550199" --image "here's my licence"
```

This posts a real-shaped 360dialog payload to the webhook, so it exercises the
same code path production does: dedupe → store → classify → apply rules →
create tasks/follow-ups → ask for missing documents.

---

## What it does

| Area | Summary |
|---|---|
| **Dashboard** | Built around "what needs doing today" — overdue tasks, follow-ups due, unread conversations, clients ready to bind, leads that have gone quiet. Every card links to the filtered list behind it. |
| **Pipeline** | Configurable stages, drag-and-drop board, full stage history with time-in-stage. |
| **WhatsApp** | Inbound messages, images, PDFs, voice-note metadata and delivery receipts. Reply from inside the CRM. Conversations attach to clients by phone number; unknown numbers become leads. |
| **AI understanding** | Classifies each message into a closed set of intents with a confidence score, and extracts structured detail. Never acts on its own. |
| **AI document reading** | Reads licences, ownerships, void cheques and more. Fills blank fields when confident; proposes everything else for a person to accept. |
| **Documents** | Private S3 storage, per-client checklist, automatic collection with anti-nag limits, verification workflow. |
| **Quotes** | Several insurers per client, side-by-side, with the chosen one recorded. |
| **Policies** | Binding is permission-gated, blocked while required documents are outstanding, and impossible for automation. |
| **Tasks & follow-ups** | Separate queues, created by people and by rules, deduplicated so automation cannot spam. |
| **Analytics** | Leads, conversion, age groups, insurers, sources, lost reasons, time-in-stage, team activity. |
| **Settings** | Stages, insurers, lead sources, lost reasons, document types, task types, quote statuses, age groups, custom fields, automation thresholds, users and permissions — all editable without a developer. |

---

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **PostgreSQL** via **Prisma 7** (driver adapter, no engine binary)
- **Tailwind CSS 4** with semantic design tokens
- **360dialog** for WhatsApp · **OpenAI** for understanding · **S3** for documents · **SQS** or Postgres for jobs

Every external provider sits behind an interface with an offline
implementation, so the whole application runs — and is developed and tested —
with no third-party credentials at all.

---

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm start            # run the production build
npm run worker       # background job worker (required in production)

npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run lint         # next lint

npm run db:migrate   # create + apply a migration (development)
npm run db:deploy    # apply migrations (production)
npm run db:seed      # reference + demo data
npm run db:studio    # browse the database
```

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the code is organised and why; where to make a given change |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Lightsail setup, Postgres, S3, SQS, HTTPS, systemd, backups |
| [`docs/WHATSAPP.md`](docs/WHATSAPP.md) | Connecting 360dialog, webhook setup, testing, templates |
| [`docs/AI.md`](docs/AI.md) | What AI is allowed to do, confidence thresholds, prompts |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, controls, what to check before go-live |
| [`docs/adr/`](docs/adr/) | Architectural decisions and the reasoning behind them |

---

## Project layout

```
src/
  app/            Next.js routes — pages and API endpoints (UI only)
  ui/             Presentational components and design tokens
  server/         Server actions: the bridge from UI to core
  core/           Business logic. Framework-free. The heart of the system.
    auth/         sessions, passwords
    clients/      clients, drivers, vehicles, field provenance
    pipeline/     stage movement and history
    quotes/       quote comparison
    policies/     policies and binding
    documents/    storage, checklist, applying extractions
    messaging/    conversations, inbound ingestion, outbound send
    ai/           orchestration and the suggestion queue
    workflows/    the rules engine — what happens when a client says X
    tasks/ followups/ notifications/ analytics/ dashboard/ settings/ users/
  integrations/   Swappable providers: whatsapp, ai, storage, queue
  worker/         Background job runner
  lib/            Cross-cutting: env, db, errors, logging, permissions
prisma/           Schema, migrations, seed
docs/             Architecture, deployment, ADRs
tests/            Vitest — rules, permissions, parsing, helpers
```

The dependency rule is one-way: `app → server → core → integrations → lib`.
Nothing in `core/` imports from `app/` or `ui/`, which is what makes it possible
to redesign the entire interface without touching business logic.
