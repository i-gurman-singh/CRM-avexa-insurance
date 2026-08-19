# 5. AI suggests, business rules decide, humans approve

**Status:** accepted · this is the load-bearing decision in the system

## Context

AI reads every inbound message and every document. The obvious implementation
is to let the model decide what to do: move the stage, update the field, send
the reply. That is also how this kind of system goes wrong in a way that costs
a brokerage its licence.

## Decision

Three separate layers, with the boundaries enforced in code rather than by
prompt:

1. **AI describes.** The provider returns an intent, a confidence, and
   extracted values. It is asked only questions of fact.
2. **Rules decide.** `core/workflows/rules.ts` maps intents to *proposed*
   actions. Rules are pure functions with no database access.
3. **The engine applies or defers.** `core/workflows/engine.ts` decides, using
   business policy rather than model confidence alone, whether each proposal
   happens now or waits for a person.

## The decision table

| Action | Applied automatically when |
|---|---|
| Label / priority / attention flag | always — cosmetic and reversible |
| Create a task or follow-up | always — a task is a prompt for a human, not an act |
| Request documents | rule allows it AND setting on AND outbound automation enabled |
| Move stage | rule allows it AND confidence ≥ threshold AND not a terminal stage |
| Move to Ready to Bind / Lost | **never** |
| Overwrite a populated field | **never** |
| Send any message | **never** — drafts are offered |
| Bind, price, underwrite, decide coverage | **not expressible** — no such action exists |

## Reasoning

The distinction that makes this work is between *reversible* and *consequential*
actions. Mislabelling a conversation costs nothing. Telling a customer they are
covered when they are not is a regulatory incident. Automation is allowed on the
first category and withheld on the second, and confidence scores are not
permitted to blur the line — a 0.99 confidence on "mark this client lost" still
waits for a person, because being right 99% of the time is not good enough when
the 1% is a lost customer nobody knew about.

The last row of the table is enforced three ways: the action type union has no
case for it, `bindPolicy` throws when the actor is the automation system, and a
test asserts that no rule can produce one. A prompt alone is not a control.

## Consequences

- Staff review a suggestion queue. That is real work, and it is the point.
- Rules are pure and therefore exhaustively testable without a database.
- Accepting a suggestion calls the same service a human uses manually, so there
  is no second automation path that can drift from the first.
- Changing what the CRM does when a customer says something is a change to one
  readable file that a broker could review.
