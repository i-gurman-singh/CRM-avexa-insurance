import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import type { FieldSource } from '@/lib/types';
import { actorUserId, isSystemActor, type AnyActor } from '@/core/context';

/**
 * Field provenance.
 *
 * The CRM must always be able to answer: "where did this value come from, and
 * has a human checked it?" That matters because AI reads driver licences and
 * ownerships, and a wrong licence number quietly propagating into a quote is a
 * real business risk.
 *
 * Three states are visible in the UI:
 *   MANUAL          typed by a person
 *   AI_EXTRACTED    proposed by AI, not yet confirmed  -> shown with a warning
 *   STAFF_VERIFIED  AI proposed, a person confirmed it -> shown as trusted
 */

export interface RecordProvenanceInput {
  entityType: 'client' | 'driver' | 'vehicle';
  entityId: string;
  fieldPath: string;
  source: FieldSource;
  confidence?: number | null;
  /** Document id, message id, or user id that produced the value. */
  sourceRef?: string | null;
  previousValue?: unknown;
  currentValue?: unknown;
  verifiedBy?: AnyActor | null;
}

export async function recordProvenance(
  input: RecordProvenanceInput,
  client: DbClient = db,
): Promise<void> {
  const verifiedByUserId =
    input.verifiedBy && !isSystemActor(input.verifiedBy) ? actorUserId(input.verifiedBy) : null;

  const isVerified = input.source === 'STAFF_VERIFIED' || input.source === 'MANUAL';

  await client.fieldProvenance.upsert({
    where: {
      entityType_entityId_fieldPath: {
        entityType: input.entityType,
        entityId: input.entityId,
        fieldPath: input.fieldPath,
      },
    },
    create: {
      entityType: input.entityType,
      entityId: input.entityId,
      fieldPath: input.fieldPath,
      source: input.source,
      confidence: input.confidence ?? null,
      sourceRef: input.sourceRef ?? null,
      previousValue: toJson(input.previousValue),
      currentValue: toJson(input.currentValue),
      verifiedByUserId: isVerified ? verifiedByUserId : null,
      verifiedAt: isVerified ? new Date() : null,
    },
    update: {
      source: input.source,
      confidence: input.confidence ?? null,
      sourceRef: input.sourceRef ?? null,
      previousValue: toJson(input.previousValue),
      currentValue: toJson(input.currentValue),
      verifiedByUserId: isVerified ? verifiedByUserId : null,
      verifiedAt: isVerified ? new Date() : null,
    },
  });
}

/** Record several fields at once — used after applying a document extraction. */
export async function recordProvenanceBatch(
  inputs: RecordProvenanceInput[],
  client: DbClient = db,
): Promise<void> {
  for (const input of inputs) {
    await recordProvenance(input, client);
  }
}

/** Map of fieldPath -> provenance, for rendering badges on a form. */
export async function getProvenanceMap(
  entityType: 'client' | 'driver' | 'vehicle',
  entityId: string,
) {
  const rows = await db.fieldProvenance.findMany({
    where: { entityType, entityId },
    include: { verifiedByUser: { select: { id: true, name: true } } },
  });

  return Object.fromEntries(rows.map((r) => [r.fieldPath, r]));
}

/** Provenance for many entities at once, keyed "<entityId>:<fieldPath>". */
export async function getProvenanceMapMany(
  entityType: 'client' | 'driver' | 'vehicle',
  entityIds: string[],
) {
  if (!entityIds.length) return {};
  const rows = await db.fieldProvenance.findMany({
    where: { entityType, entityId: { in: entityIds } },
  });
  return Object.fromEntries(rows.map((r) => [`${r.entityId}:${r.fieldPath}`, r]));
}

/** Mark AI-extracted values as checked by a human. */
export async function verifyFields(
  actor: AnyActor,
  entityType: 'client' | 'driver' | 'vehicle',
  entityId: string,
  fieldPaths: string[],
): Promise<void> {
  await db.fieldProvenance.updateMany({
    where: { entityType, entityId, fieldPath: { in: fieldPaths } },
    data: {
      source: 'STAFF_VERIFIED',
      verifiedByUserId: actorUserId(actor),
      verifiedAt: new Date(),
    },
  });
}

/** Count of AI-extracted, unverified fields on a client and its children. */
export async function countUnverifiedFields(entityIds: {
  clientId: string;
  driverIds: string[];
  vehicleIds: string[];
}): Promise<number> {
  return db.fieldProvenance.count({
    where: {
      source: 'AI_EXTRACTED',
      OR: [
        { entityType: 'client', entityId: entityIds.clientId },
        { entityType: 'driver', entityId: { in: entityIds.driverIds } },
        { entityType: 'vehicle', entityId: { in: entityIds.vehicleIds } },
      ],
    },
  });
}

/**
 * Wrap a value so it can be stored in a nullable Json column. We always store
 * an object (never SQL NULL) so "the field was cleared" and "we never recorded
 * anything" stay distinguishable.
 */
function toJson(value: unknown): object {
  if (value instanceof Date) return { value: value.toISOString() };
  if (value === undefined) return { value: null };
  return { value: value ?? null };
}
