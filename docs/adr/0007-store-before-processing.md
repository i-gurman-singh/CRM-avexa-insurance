# 7. Store inbound messages before processing them

**Status:** accepted

## Context

Inbound WhatsApp messages trigger AI classification, media downloads and
workflow evaluation. Each of those can be slow and each can fail. WhatsApp
providers expect a fast acknowledgement and retry aggressively when they do not
get one.

## Decision

The webhook does the minimum and returns:

1. Write a `WebhookEvent` row — the idempotency ledger.
2. Find or create the client.
3. Write the `Message` and its attachments, verbatim.
4. Bump denormalised counters.
5. Enqueue jobs.
6. **Return 200.**

Everything slow happens in the worker.

## Reasoning

A customer's message is the one thing in this system that cannot be
reconstructed. If it is in Postgres, every other failure is recoverable —
re-run the analysis, re-download the media, fix the rule and replay. If it is
not, it is gone, and the customer's impression is that the brokerage ignored
them.

Two further consequences of this ordering:

**Duplicates are handled by the database.** `WebhookEvent(provider, externalId)`
and `Message(channel, externalId)` are unique constraints. Providers retry
routinely; relying on application-level checks would leave a race window.

**The webhook returns 200 even on internal failure.** A non-200 makes the
provider retry, and a retry storm on top of a broken deploy is strictly worse
than a message that can be replayed from the stored payload.

## Consequences

- The worker is not optional in production. Without it, media and AI processing
  sit in the queue untouched — which is why the Jobs screen exists and why
  `/api/health` reports queue depth.
- Between the webhook returning and the worker running, a message is visible in
  the CRM without its AI classification. That is the correct trade: staff can
  see and answer it immediately.
- Jobs must be safe to run twice, because the queue guarantees at-least-once
  delivery. Every handler checks current state before acting.
