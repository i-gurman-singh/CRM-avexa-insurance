# AI

The CRM uses a language model for two jobs: understanding what a customer said,
and reading what is printed on a document. It is not used for anything else,
and it decides nothing.

---

## The boundary

> **AI describes. Business rules decide. People approve anything that matters.**

The model is only ever asked to answer questions of fact:

- *What is this customer asking for?* — classification into a closed set
- *What is printed on this licence?* — transcription

It is never asked to answer questions of judgement:

- Is this person eligible? · What should this cost? · What coverage suits them?
  · Should we bind this?

Those are regulated decisions that belong to licensed humans. The system prompts
say so explicitly, the action type union in `core/workflows/types.ts` has no
case for them, and `tests/workflows.test.ts` asserts that no rule can produce
one. Three layers, because a prompt alone is not a control.

`bindPolicy` refuses outright when the actor is the automation system — the
check is in the domain service, not just the UI, so a future API client or rule
cannot route around it.

---

## Understanding messages

Every inbound text message is classified into one intent from a fixed list
(`src/integrations/ai/vocabulary.ts`) with a confidence score, plus sentiment,
urgency, and any structured detail it can extract — a mentioned price, a
vehicle, a requested insurer, a callback time.

The result is stored in `MessageAnalysis` with the provider, model and prompt
version, so a change in behaviour after a model upgrade is traceable rather than
mysterious.

Adding an intent: add it to `INTENTS` and `INTENT_DESCRIPTIONS`, then decide
what the CRM should do about it in `core/workflows/rules.ts`. The two are
deliberately separate files.

---

## Reading documents

Images and PDFs are passed to a vision model with an extraction schema chosen
by document type (`EXTRACTORS`). The prompt instructs it to transcribe only —
never to normalise, correct or complete a value it cannot clearly read — and to
return `null` with zero confidence rather than guessing.

Each extraction is stored as its own row. Re-running extraction adds a row
rather than destroying the previous one.

### The rule that matters

**An existing value is never overwritten by AI.**

| Field state | Confidence | What happens |
|---|---|---|
| empty | ≥ threshold | filled in, marked `AI_EXTRACTED` |
| empty | < threshold | suggestion for a person |
| populated | any | suggestion for a person |

Accepting a suggestion promotes the value to `STAFF_VERIFIED`. The client form
shows a small chip on every field saying which of these it is, so staff can tell
at a glance whether a licence number was typed by a colleague or read off a
photo by a model that nobody has checked.

---

## Confidence thresholds

All configurable in **Settings → Automation & AI**:

| Setting | Default | Meaning |
|---|---|---|
| `ai.stageChangeMinConfidence` | 0.85 | below this, a stage move becomes a suggestion |
| `ai.fieldUpdateMinConfidence` | 0.90 | below this, an extracted value becomes a suggestion |
| `ai.uncertaintyThreshold` | 0.60 | below this, the conversation is flagged "AI unsure" |

Some actions never auto-apply regardless of confidence, because being right 95%
of the time is not good enough when the 5% is embarrassing:

- moving a client to **Ready to Bind**
- marking a client **Lost**
- overwriting any populated field
- sending any message (drafts are offered, never sent)

---

## The suggestion queue

Everything the rules proposed but were not allowed to apply appears under **AI
suggestions**, with the confidence, the reasoning, and the message or document
that prompted it. Accepting one calls exactly the same service function a person
would have used manually — there is no second automation path that could drift
from the manual one.

Suggestions expire (48 hours for reply drafts, a week for stage changes) so the
queue stays a to-do list rather than an archive.

---

## Cost

Roughly, at current OpenAI pricing:

- message classification: `gpt-4o-mini`, a fraction of a cent per message
- document extraction: `gpt-4o` vision, a few cents per document

For a brokerage handling a few hundred messages a day this is single-digit
dollars per day. The controls if it matters: turn off `ai.enabled` or
`ai.documentAnalysisEnabled`, or point `OPENAI_MODEL_TEXT` at a cheaper model.

Only inbound text is classified; outbound messages, stickers and system events
are skipped. Only images and PDFs go to the vision model.

---

## Swapping providers

`AiProvider` (`src/integrations/ai/types.ts`) has two methods. To move to
Anthropic, Gemini, or a self-hosted model: write one class implementing it, add
a case to `getAi()`, add the config to `env.ts`. Nothing in `core/`, `app/` or
`ui/` changes.

The offline `mock` provider is a deterministic keyword classifier. It is good
enough to exercise every downstream path — including the low-confidence review
queue, which it triggers deliberately — and it costs nothing, which is what
makes it practical to develop and test the CRM without a key.

---

## Privacy

- Message text and document images are sent to the AI provider. If that is a
  problem for your regulator, turn AI off in Settings; the CRM works without it,
  it just stops classifying and extracting.
- The AI provider is not given the client database — only the message being
  classified, a short conversation excerpt, and a few non-identifying context
  flags (stage, whether a quote exists, which documents are outstanding).
- Extractions are stored in your database, not the provider's.
- Every AI action appears on the client's timeline attributed to "AI", so staff
  can always see what the model did and when.
