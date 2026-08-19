# WhatsApp integration

The CRM talks to WhatsApp through **360dialog**, a Business Solution Provider
for the WhatsApp Business Platform. The adapter is written against the Cloud
API payload shape, so it also works against Meta directly with only the base URL
and auth header changed.

---

## Connecting the number

1. Sign up at [hub.360dialog.com](https://hub.360dialog.com) and complete the
   embedded signup with your existing WhatsApp Business number.
2. Copy the **API key** from the hub into `DIALOG360_API_KEY`.
3. Generate a webhook token: `openssl rand -hex 32` → `WHATSAPP_WEBHOOK_TOKEN`.
4. Set `WHATSAPP_PROVIDER=360dialog` and restart the app.
5. Register the webhook URL in the 360dialog hub:

   ```
   https://crm.yourdomain.com/api/webhooks/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>
   ```

6. Send a message to the business number from your own phone. Within a second
   or two a lead should appear on the dashboard.

If your plan signs payloads, also set `WHATSAPP_WEBHOOK_SECRET`; the adapter
verifies `X-Hub-Signature-256` when it is present.

---

## What comes in

| WhatsApp type | Stored as | Notes |
|---|---|---|
| text | `TEXT` | classified by AI |
| image | `IMAGE` + attachment | downloaded, stored, read by AI |
| document | `DOCUMENT` + attachment | filename preserved |
| audio / voice | `AUDIO` + attachment | metadata and duration; not transcribed |
| video | `VIDEO` + attachment | stored only |
| location, contacts, sticker | typed rows | summarised in the timeline |
| delivery receipts | status update | sent → delivered → read, never regressing |

Everything is stored verbatim in `Message.rawPayload` **before** anything
interprets it.

---

## Testing without a live number

```bash
# text
node scripts/simulate-whatsapp.mjs "+14165550199" "Hi, I need car insurance"

# a bare photo
node scripts/simulate-whatsapp.mjs "+14165550199" --image

# a photo with a caption
node scripts/simulate-whatsapp.mjs "+14165550199" --image "here's my licence"

# a PDF
node scripts/simulate-whatsapp.mjs "+14165550199" --document ownership.pdf
```

The simulator posts a real 360dialog-shaped payload, and the offline provider
parses it with the same parser the live provider uses — so this exercises the
production path, not a shortcut. With `WHATSAPP_PROVIDER=mock` outbound messages
are logged instead of sent, so you can watch the full conversation flow without
messaging anyone.

---

## The 24-hour window

WhatsApp only allows free-form messages within 24 hours of the customer's last
message. Outside it you must send an approved **template**.

The CRM handles this honestly rather than silently failing: free-form sends go
through `sendMessage`, templates through `sendTemplate`, and a send that
WhatsApp rejects is marked `FAILED` on the message with the provider's error
visible in the conversation — not swallowed.

Templates worth having approved:

| Purpose | Example |
|---|---|
| Document reminder | "Hi {{1}}, we still need your {{2}} to finish your quote. You can send a photo right here." |
| Quote follow-up | "Hi {{1}}, just following up on the quote we sent. Any questions?" |
| Renewal notice | "Hi {{1}}, your policy renews on {{2}}. Would you like us to review it?" |

Approve them in the 360dialog hub, then call `sendTemplate` with the name.

---

## Automated replies

Two independent controls, both off by default:

1. **`AUTOMATION_OUTBOUND_ENABLED`** (environment) — the master switch. While
   `false`, every message the CRM would have sent becomes a task with the text
   ready for a person to review and send. This is the recommended setting for
   the first weeks: you get to read exactly what the CRM *would* have said,
   with no risk.
2. **`automation.autoRequestDocuments`** (Settings) — whether document requests
   are automated at all.

Two anti-nag limits apply regardless, both configurable:

- `automation.maxDocumentRequestsPerItem` (default 2) — after this, the CRM
  stops asking and creates a task for a human to phone instead.
- `automation.documentRequestCooldownHours` (default 24) — never asks twice for
  the same document inside the window.

Requests are also batched: one message listing everything outstanding, rather
than one message per document.

---

## Reliability

**Duplicates.** Providers retry deliveries routinely. Two database unique
constraints make that a no-op: `WebhookEvent(provider, externalId)` and
`Message(channel, externalId)`. This is enforced by Postgres, not by
application logic that could race.

**Speed.** The webhook does the minimum — verify, parse, persist, enqueue — and
returns 200. AI analysis, media downloads and rule evaluation happen in the
worker.

**Failure.** The webhook returns 200 even when downstream processing throws,
because a non-200 makes the provider retry, and a retry storm on top of a broken
deploy is strictly worse than a message that can be replayed. The raw payload is
always stored, so nothing is lost; failed jobs surface in **Settings →
Background jobs** with a retry button.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Webhook returns 401 | `token` query parameter does not match `WHATSAPP_WEBHOOK_TOKEN` |
| `{"ok":true,"empty":true}` | Payload parsed but contained no messages — usually a status-only delivery |
| Messages arrive, nothing else happens | Worker not running (`systemctl status crm-worker`), or `QUEUE_PROVIDER=inline` in production |
| No AI classification | `ai.enabled` off in Settings, or `OPENAI_API_KEY` missing |
| Replies not sending | Outside the 24-hour window — check the failed message for the provider's error |
| Documents not extracted | `ai.documentAnalysisEnabled` off, or the file is not an image/PDF |

Provider-level delivery logs live in the 360dialog hub; the CRM's own view of
every message, including failures, is on the client's Conversation tab.
