# 4. PostgreSQL on the application server

**Status:** accepted · revisit at ~50k clients or when a second app instance is added

## Context

The brief specified Postgres on the same Lightsail instance as the application,
initially.

## Decision

Follow that, and make moving away from it a one-line change.

## Reasoning

At brokerage scale the database will hold tens of thousands of rows, not
millions. A local socket connection removes a network hop from every query and
removes a whole class of connectivity failure. It is also materially cheaper
than a managed instance, which matters when the CRM has not yet proved itself.

The risk being accepted is that a single instance failure takes both the app and
the database. This is mitigated by daily `pg_dump` to S3, Lightsail snapshots,
and documents living in S3 rather than on the instance — so the blast radius is
"restore from last night's backup", not "the business is gone".

## Consequences

- `DATABASE_URL` is the only thing that changes to move to RDS or Lightsail
  Managed Databases. No code changes.
- Backups are not optional. The deployment guide makes testing a restore a
  go-live checklist item, because an untested backup is a hope.
- Postgres tuning for a small instance is documented rather than left to
  defaults, which assume a dedicated machine.
