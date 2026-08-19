# 1. A modular monolith, not microservices

**Status:** accepted

## Context

The brief asked for a system that is easy to change: WhatsApp, AI, UI,
workflows and analytics should each be replaceable without disturbing the
others. That requirement is often read as "use microservices".

## Decision

One Next.js application plus one worker process, organised into strict internal
modules with a one-way dependency rule:

```
app/ → server/ → core/ → integrations/ → lib/
```

## Reasoning

The isolation the brief actually asks for is *logical*, and logical isolation
does not require network boundaries. Enforcing the dependency direction with
module structure and code review buys the same substitutability as separate
services, without distributed transactions, service discovery, or three more
things to deploy at 9pm.

Concretely: the WhatsApp provider is swappable because it sits behind an
interface, not because it runs in a different process. Splitting it out would
add failure modes and remove none.

For a brokerage running a handful of staff on a single Lightsail instance, the
operational cost of microservices is a real, daily tax paid against a benefit
that does not arrive.

## Consequences

- One build, one deploy, one place to look when something is wrong.
- The dependency rule is a convention, so it must be defended in review. The
  compiler does not enforce it.
- Horizontal scaling means running several copies of the whole app. Fine —
  the app is stateless apart from the in-process rate limiter, which is
  flagged in the code as the thing to replace first.
