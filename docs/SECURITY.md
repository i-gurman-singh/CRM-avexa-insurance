# Security

This system holds names, dates of birth, addresses, driver licence numbers,
VINs and banking details. That is a serious amount of personal data for a small
brokerage to be responsible for. This document describes what is protected, how,
and what to verify before going live.

---

## Authentication

Sessions are short-lived JWTs in an `httpOnly`, `SameSite=Lax`, `Secure` cookie.
The token carries only a user id — **the role and permissions are read from the
database on every request**, so deactivating an account or changing a role takes
effect immediately rather than at the next login.

Passwords are bcrypt at cost 12, with length-based strength rules (12 characters
minimum, common words rejected). Failed sign-ins are audited. Sign-in runs a
password comparison even when the account does not exist, so response timing
does not reveal which emails are registered, and the error message never
distinguishes "no such user" from "wrong password".

---

## Authorisation

Four roles — Administrator, Broker, Agent, Assistant — plus per-user exceptions
for the cases roles do not fit.

Two deliberate defaults worth knowing:

- **Agents cannot bind policies.** Binding requires `policies.bind`, held by
  brokers and administrators.
- **Assistants cannot download documents.** They can see that a licence exists
  and work with its extracted summary, but not pull the raw image.

Permission checks live in the **domain services**, not only in the UI. Hiding a
button is a usability affordance; `requirePermission` inside the service is the
control. A future API client or background rule cannot route around it.

---

## Documents

- Stored privately in S3. **There is no code path that produces a public URL.**
- Downloads go through an authenticated route that checks `documents.download`,
  writes an audit entry, then mints a signed URL valid for five minutes.
- Every download and inline preview is audited — for personal insurance data,
  knowing who looked at what matters as much as controlling who can.
- Responses carry `Cache-Control: private, no-store` so no proxy retains them.
- The bucket must have public access blocked, encryption on, and versioning on
  (see `docs/DEPLOYMENT.md`).

---

## Data protection

- **Secrets never reach the browser.** All provider calls are server-side; no
  `NEXT_PUBLIC_*` variable exists in this codebase. `@/lib/server-guard` throws
  loudly if a server module is ever pulled into a client bundle.
- **Input validation** with Zod at every entry point — server actions, API
  routes, webhooks.
- **SQL injection** is not reachable through the ORM; the few raw queries use
  parameterised templates.
- **Audit logs redact** licence numbers, VINs, account numbers and dates of
  birth. The log records that something happened and who did it — it is not a
  second copy of the client database.
- **Logs mask phone numbers** and redact credentials.

---

## Web hardening

Set in `next.config.mjs` and the middleware:

- `X-Frame-Options: DENY` — no clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — camera, microphone, geolocation all denied
- `Strict-Transport-Security` with a two-year max-age and preload

CSRF is handled by Next.js server actions (origin-checked POSTs) plus
`SameSite=Lax` cookies. The one non-action POST — the WhatsApp webhook — is
authenticated by a token and optional HMAC signature instead.

---

## The webhook

- A shared token in the URL, checked before anything else runs.
- Optional `X-Hub-Signature-256` HMAC verification when the provider signs.
- Rate limited per IP.
- Returns 200 even on internal failure, deliberately: a non-200 makes the
  provider retry, and a retry storm on top of a broken deploy is worse than a
  message replayed later from the stored raw payload.

---

## Regulated actions

Binding a policy, selecting a quote, and overwriting client identity fields
cannot be performed by automation at all. `bindPolicy` throws if the actor is
the system, checks the permission, and refuses while required documents are
outstanding — an override is possible for a broker who knows what they are
doing, and it is recorded with the reason.

---

## What is not included

Being explicit, so nobody assumes otherwise:

- **No MFA.** Worth adding before this holds a large book of business.
- **No password reset by email.** Administrators set passwords directly. This
  is deliberate for a four-person team; it does not scale.
- **No field-level encryption.** Data is encrypted in transit and at rest at the
  disk/bucket level, but licence numbers are not separately encrypted in the
  database. A DBA can read them.
- **No automated PII deletion.** Retention and erasure requests are manual.
- **In-process rate limiting** — correct for one instance, needs shared state if
  you scale horizontally.

---

## Before go-live

- [ ] `NEXTAUTH_SECRET` is 32 random bytes
- [ ] Every seeded password changed; demo accounts removed
- [ ] S3: public access blocked, encryption on, versioning on
- [ ] AWS credentials scoped to the one bucket
- [ ] Postgres on localhost only; firewall allows 22/80/443
- [ ] HTTPS with auto-renewal; HSTS confirmed
- [ ] Webhook token is random and secret
- [ ] Backups running and a restore tested
- [ ] Staff on the narrowest role that lets them work
- [ ] Someone has read the audit log once and knows where it is

## If something goes wrong

1. Rotate the affected credential (`.env`, restart both services).
2. Deactivate compromised accounts — takes effect on their next request.
3. Read **Settings → Audit log**, filtered by `document.download` and
   `document.view`, to establish what was accessed.
4. Ontario's privacy regulator expects notification of a breach involving
   personal information. Take advice early.
