# 6. Business configuration as data, not code

**Status:** accepted

## Context

The brief was explicit: the business will evolve, and administrators should be
able to change stages, insurers, document types, lost reasons, task types, age
groups and thresholds without a developer.

## Decision

Everything the business might reasonably want to change is a database row or a
settings value. Enums are reserved for things that are structural to the code
and would require a code change anyway — message direction, job status,
provenance source.

A `customFields` JSON column on the major entities lets an administrator add a
field with no migration at all.

## Reasoning

The test applied to each candidate was: *would changing this require a developer
to think, or only to type?* Adding "Gore Mutual" to a list of insurers is
typing. Adding a new kind of regulated action is thinking. The first belongs in
Settings; the second belongs in code.

Pipeline stages get one refinement: the display name is editable but the `key`
is fixed once created, because workflow rules reference keys. Renaming "Quoting"
to "In Progress" is always safe; silently changing what `quoting` means is not.

## Consequences

- More joins than an enum-based schema. At this volume, irrelevant.
- Deactivate rather than delete wherever historical records point at a lookup,
  so analytics over past business stay correct.
- The seed script is load-bearing: it establishes the reference data the
  application needs to function at all. It is written to be idempotent.
- Custom fields are convenient but slower to filter and report on. The Settings
  screen says so, and recommends promoting a field to a real column once it
  becomes load-bearing.
