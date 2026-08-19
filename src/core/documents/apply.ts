import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { ExtractedField } from '@/integrations/ai';
import { EXTRACTORS } from '@/integrations/ai';
import { recordActivity } from '@/core/activity/service';
import { recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, type AnyActor } from '@/core/context';
import { recordProvenance } from '@/core/clients/provenance';
import { getSetting } from '@/core/settings/service';

const logger = log('documents:apply');

/**
 * Applying AI-extracted document data to client records.
 *
 * The rule that matters: **an existing value is never overwritten by AI.**
 *
 *   empty field + high confidence  -> filled in, marked AI_EXTRACTED
 *   empty field + low confidence   -> suggestion for staff to accept
 *   populated field, any confidence -> suggestion for staff to accept
 *
 * Accepting a suggestion promotes the value to STAFF_VERIFIED, so the UI can
 * always show whether a human has actually looked at it.
 */

type Entity = 'client' | 'driver' | 'vehicle';

interface Target {
  entity: Entity;
  field: string;
}

function parseTarget(target: string): Target | null {
  const [entity, field] = target.split('.');
  if (!entity || !field) return null;
  if (entity !== 'client' && entity !== 'driver' && entity !== 'vehicle') return null;
  return { entity, field };
}

/** Coerce an extracted value to the shape the column expects. */
function coerceValue(value: unknown, type: string): unknown {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'date': {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 'yes';
    default:
      return String(value).trim();
  }
}

export interface ApplyExtractionResult {
  applied: Array<{ target: string; value: unknown }>;
  suggested: Array<{ target: string; value: unknown; reason: 'low_confidence' | 'would_overwrite' }>;
  skipped: Array<{ target: string; reason: string }>;
}

export interface ApplyExtractionOptions {
  /** Which driver/vehicle the values belong to. Falls back to the primary. */
  driverId?: string | null;
  vehicleId?: string | null;
  /**
   * Set when a human is accepting a suggestion — bypasses the confidence
   * threshold and the overwrite guard, and marks values STAFF_VERIFIED.
   */
  humanApproved?: boolean;
}

/**
 * Apply an extraction result. Called automatically after AI reads a document,
 * and again (with humanApproved) when staff accept suggested values.
 */
export async function applyExtraction(
  actor: AnyActor,
  documentId: string,
  extractionId: string,
  opts: ApplyExtractionOptions = {},
  client: DbClient = db,
): Promise<ApplyExtractionResult> {
  const extraction = await client.documentExtraction.findUnique({
    where: { id: extractionId },
    include: { document: true },
  });
  if (!extraction) throw new NotFoundError('Extraction');

  const document = extraction.document;
  const spec = EXTRACTORS[extraction.extractorKey];
  const result: ApplyExtractionResult = { applied: [], suggested: [], skipped: [] };
  if (!spec) {
    logger.warn({ extractorKey: extraction.extractorKey }, 'No extractor spec; nothing to apply');
    return result;
  }

  const minConfidence = await getSetting('ai.fieldUpdateMinConfidence');
  const fields = (extraction.fields ?? {}) as unknown as Record<string, ExtractedField>;

  // Resolve which driver/vehicle rows these values attach to.
  const driverId =
    opts.driverId ??
    (
      await client.driver.findFirst({
        where: { clientId: document.clientId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
    )?.id ??
    null;

  const vehicleId =
    opts.vehicleId ??
    (
      await client.vehicle.findFirst({
        where: { clientId: document.clientId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
    )?.id ??
    null;

  const clientUpdates: Record<string, unknown> = {};
  const driverUpdates: Record<string, unknown> = {};
  const vehicleUpdates: Record<string, unknown> = {};

  const [clientRow, driverRow, vehicleRow] = await Promise.all([
    client.client.findUnique({ where: { id: document.clientId } }),
    driverId ? client.driver.findUnique({ where: { id: driverId } }) : Promise.resolve(null),
    vehicleId ? client.vehicle.findUnique({ where: { id: vehicleId } }) : Promise.resolve(null),
  ]);

  for (const fieldSpec of spec.fields) {
    if (!fieldSpec.target) continue;

    const extracted = fields[fieldSpec.key];
    if (!extracted || extracted.value === null || extracted.value === '') continue;

    const target = parseTarget(fieldSpec.target);
    if (!target) continue;

    const value = coerceValue(extracted.value, fieldSpec.type);
    if (value === null) {
      result.skipped.push({ target: fieldSpec.target, reason: 'unparseable value' });
      continue;
    }

    // Which row does this field live on, and does it already have a value?
    const row =
      target.entity === 'client' ? clientRow : target.entity === 'driver' ? driverRow : vehicleRow;

    if (!row) {
      result.skipped.push({
        target: fieldSpec.target,
        reason: `no ${target.entity} record to attach this to`,
      });
      continue;
    }

    const current = (row as Record<string, unknown>)[target.field];
    const isEmpty = current === null || current === undefined || current === '';

    if (!opts.humanApproved) {
      if (!isEmpty) {
        // The important guard: never silently change data a human relies on.
        result.suggested.push({ target: fieldSpec.target, value, reason: 'would_overwrite' });
        continue;
      }
      if (extracted.confidence < minConfidence) {
        result.suggested.push({ target: fieldSpec.target, value, reason: 'low_confidence' });
        continue;
      }
    }

    const bucket =
      target.entity === 'client'
        ? clientUpdates
        : target.entity === 'driver'
          ? driverUpdates
          : vehicleUpdates;

    bucket[target.field] = value;
    result.applied.push({ target: fieldSpec.target, value });

    await recordProvenance(
      {
        entityType: target.entity,
        entityId: target.entity === 'client' ? document.clientId : (target.entity === 'driver' ? driverId! : vehicleId!),
        fieldPath: target.field,
        source: opts.humanApproved ? 'STAFF_VERIFIED' : 'AI_EXTRACTED',
        confidence: extracted.confidence,
        sourceRef: documentId,
        previousValue: current,
        currentValue: value,
        verifiedBy: opts.humanApproved ? actor : null,
      },
      client,
    );
  }

  if (Object.keys(clientUpdates).length) {
    await client.client.update({ where: { id: document.clientId }, data: clientUpdates });
  }
  if (driverId && Object.keys(driverUpdates).length) {
    await client.driver.update({ where: { id: driverId }, data: driverUpdates });
  }
  if (vehicleId && Object.keys(vehicleUpdates).length) {
    await client.vehicle.update({ where: { id: vehicleId }, data: vehicleUpdates });
  }

  // Record the values that need a human decision as suggestions.
  for (const suggestion of result.suggested) {
    const target = parseTarget(suggestion.target)!;
    await client.aiSuggestion.create({
      data: {
        clientId: document.clientId,
        documentId,
        kind: 'FIELD_UPDATE',
        confidence: fields[spec.fields.find((f) => f.target === suggestion.target)!.key]?.confidence ?? 0,
        payload: {
          target: suggestion.target,
          entity: target.entity,
          entityId:
            target.entity === 'client' ? document.clientId : target.entity === 'driver' ? driverId : vehicleId,
          field: target.field,
          value: suggestion.value instanceof Date ? suggestion.value.toISOString() : suggestion.value,
          extractionId,
        } as object,
        rationale:
          suggestion.reason === 'would_overwrite'
            ? 'This field already has a value. A person should confirm the change.'
            : 'Confidence was below the automatic threshold.',
      },
    });
  }

  if (opts.humanApproved || result.applied.length) {
    await client.documentExtraction.update({
      where: { id: extractionId },
      data: { appliedAt: new Date(), appliedByUserId: actorUserId(actor) },
    });
  }

  if (result.applied.length) {
    await recordActivity(
      {
        clientId: document.clientId,
        type: 'ai.document_applied',
        title: opts.humanApproved
          ? `Staff accepted ${result.applied.length} field${result.applied.length === 1 ? '' : 's'} from ${document.filename}`
          : `Filled ${result.applied.length} empty field${result.applied.length === 1 ? '' : 's'} from ${document.filename}`,
        metadata: { applied: result.applied.map((a) => a.target), suggested: result.suggested.length },
        actor,
        actorType: opts.humanApproved ? 'user' : 'ai',
        entityType: 'Document',
        entityId: documentId,
      },
      client,
    );
  }

  logger.info(
    {
      documentId,
      applied: result.applied.length,
      suggested: result.suggested.length,
      humanApproved: Boolean(opts.humanApproved),
    },
    'Extraction applied',
  );

  return result;
}

/**
 * Apply a single suggested field value after a human accepted it.
 */
export async function applyFieldSuggestion(actor: AnyActor, suggestionId: string) {
  requirePermission(actor, 'ai.applySuggestions');

  const suggestion = await db.aiSuggestion.findUnique({ where: { id: suggestionId } });
  if (!suggestion) throw new NotFoundError('Suggestion');
  if (suggestion.kind !== 'FIELD_UPDATE') throw new NotFoundError('Field suggestion');

  const payload = suggestion.payload as {
    entity: Entity;
    entityId: string;
    field: string;
    value: unknown;
    target: string;
  };

  const previous = await readCurrent(payload.entity, payload.entityId, payload.field);
  const value = normaliseForColumn(payload.field, payload.value);

  if (payload.entity === 'client') {
    await db.client.update({ where: { id: payload.entityId }, data: { [payload.field]: value } });
  } else if (payload.entity === 'driver') {
    await db.driver.update({ where: { id: payload.entityId }, data: { [payload.field]: value } });
  } else {
    await db.vehicle.update({ where: { id: payload.entityId }, data: { [payload.field]: value } });
  }

  await recordProvenance({
    entityType: payload.entity,
    entityId: payload.entityId,
    fieldPath: payload.field,
    source: 'STAFF_VERIFIED',
    confidence: suggestion.confidence,
    sourceRef: suggestion.documentId ?? suggestionId,
    previousValue: previous,
    currentValue: value,
    verifiedBy: actor,
  });

  await db.aiSuggestion.update({
    where: { id: suggestionId },
    data: { status: 'ACCEPTED', reviewedByUserId: actorUserId(actor), reviewedAt: new Date() },
  });

  await recordActivity({
    clientId: suggestion.clientId,
    type: 'ai.suggestion_accepted',
    title: `Accepted ${payload.target}`,
    actor,
  });

  await recordAudit({
    actor,
    action: 'ai.applyFieldSuggestion',
    entityType: 'AiSuggestion',
    entityId: suggestionId,
    metadata: { target: payload.target, entityId: payload.entityId },
  });

  return { applied: true };
}

async function readCurrent(entity: Entity, entityId: string, field: string): Promise<unknown> {
  const row =
    entity === 'client'
      ? await db.client.findUnique({ where: { id: entityId } })
      : entity === 'driver'
        ? await db.driver.findUnique({ where: { id: entityId } })
        : await db.vehicle.findUnique({ where: { id: entityId } });
  return row ? (row as Record<string, unknown>)[field] : null;
}

/** Date columns arrive as ISO strings once a suggestion has round-tripped JSON. */
function normaliseForColumn(field: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/date|expiry|dob/i.test(field)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}
