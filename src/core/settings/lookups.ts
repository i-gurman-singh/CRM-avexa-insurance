import '@/lib/server-guard';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { slugify } from '@/lib/utils';
import type { Priority, StageCategory } from '@/lib/types';
import { recordAudit } from '@/core/audit/service';
import { requirePermission, type AnyActor } from '@/core/context';
import { invalidateSettingsCache } from './service';

/**
 * CRUD for every configurable list in the CRM.
 *
 * Pipeline stages, insurance companies, lead sources, lost reasons, document
 * types, task types, quote statuses and age groups are all rows, not code.
 * Administrators can add, rename, reorder and deactivate them without a
 * developer.
 *
 * Deactivate rather than delete wherever historical records point at a lookup,
 * so analytics over past business stay correct.
 */

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export async function listStages(opts: { includeInactive?: boolean } = {}) {
  return db.pipelineStage.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function getStageByKey(key: string) {
  return db.pipelineStage.findUnique({ where: { key } });
}

export async function getDefaultStage() {
  const stage =
    (await db.pipelineStage.findFirst({ where: { isDefault: true, isActive: true } })) ??
    (await db.pipelineStage.findFirst({ where: { isActive: true }, orderBy: { position: 'asc' } }));
  if (!stage) throw new Error('No pipeline stages configured. Run the database seed.');
  return stage;
}

export interface StageInput {
  name: string;
  key?: string;
  description?: string | null;
  category?: StageCategory;
  color?: string;
  isDefault?: boolean;
  staleAfterHours?: number | null;
}

export async function createStage(actor: AnyActor, input: StageInput) {
  requirePermission(actor, 'settings.manage');

  const key = input.key ? slugify(input.key) : slugify(input.name);
  if (!key) throw new ValidationError('Stage name is required');

  const existing = await db.pipelineStage.findUnique({ where: { key } });
  if (existing) throw new ConflictError(`A stage with the key "${key}" already exists`);

  const last = await db.pipelineStage.findFirst({ orderBy: { position: 'desc' } });

  const stage = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.pipelineStage.updateMany({ data: { isDefault: false }, where: { isDefault: true } });
    }
    return tx.pipelineStage.create({
      data: {
        key,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? 'OPEN',
        color: input.color ?? '#64748b',
        position: (last?.position ?? 0) + 1,
        isDefault: input.isDefault ?? false,
        staleAfterHours: input.staleAfterHours ?? null,
      },
    });
  });

  await recordAudit({ actor, action: 'stage.create', entityType: 'PipelineStage', entityId: stage.id, metadata: { key } });
  return stage;
}

export async function updateStage(actor: AnyActor, id: string, input: Partial<StageInput>) {
  requirePermission(actor, 'settings.manage');

  const stage = await db.pipelineStage.findUnique({ where: { id } });
  if (!stage) throw new NotFoundError('Stage');

  const updated = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.pipelineStage.updateMany({ data: { isDefault: false }, where: { isDefault: true } });
    }
    return tx.pipelineStage.update({
      where: { id },
      data: {
        // The key is intentionally immutable: workflow rules reference it.
        name: input.name ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        category: input.category ?? undefined,
        color: input.color ?? undefined,
        isDefault: input.isDefault ?? undefined,
        staleAfterHours: input.staleAfterHours === undefined ? undefined : input.staleAfterHours,
      },
    });
  });

  await recordAudit({ actor, action: 'stage.update', entityType: 'PipelineStage', entityId: id, metadata: { ...input } });
  return updated;
}

export async function reorderStages(actor: AnyActor, orderedIds: string[]) {
  requirePermission(actor, 'settings.manage');
  await db.$transaction(
    orderedIds.map((id, index) =>
      db.pipelineStage.update({ where: { id }, data: { position: index + 1 } }),
    ),
  );
  await recordAudit({ actor, action: 'stage.reorder', entityType: 'PipelineStage', metadata: { orderedIds } });
}

/**
 * Stages are never hard-deleted while clients reference them — that would
 * orphan history. Deactivating hides the stage from pickers and the board.
 */
export async function setStageActive(actor: AnyActor, id: string, isActive: boolean) {
  requirePermission(actor, 'settings.manage');

  if (!isActive) {
    const count = await db.client.count({ where: { stageId: id, isArchived: false } });
    if (count > 0) {
      throw new ConflictError(
        `${count} client${count === 1 ? ' is' : 's are'} still in this stage. Move them first.`,
      );
    }
    const stage = await db.pipelineStage.findUnique({ where: { id } });
    if (stage?.isDefault) throw new ConflictError('Set another stage as the default first.');
  }

  const updated = await db.pipelineStage.update({ where: { id }, data: { isActive } });
  await recordAudit({ actor, action: 'stage.setActive', entityType: 'PipelineStage', entityId: id, metadata: { isActive } });
  return updated;
}

// ---------------------------------------------------------------------------
// Generic simple lookups (name + key + position + isActive)
// ---------------------------------------------------------------------------

export type SimpleLookup = 'leadSource' | 'lostReason' | 'taskType' | 'quoteStatus' | 'documentType';

export async function listLeadSources(includeInactive = false) {
  return db.leadSource.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function listLostReasons(includeInactive = false) {
  return db.lostReason.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function listInsuranceCompanies(includeInactive = false) {
  return db.insuranceCompany.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export async function listTaskTypes(includeInactive = false) {
  return db.taskType.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function listQuoteStatuses(includeInactive = false) {
  return db.quoteStatus.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function listDocumentTypes(includeInactive = false) {
  return db.documentType.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function listAgeGroups(includeInactive = false) {
  return db.ageGroup.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { position: 'asc' },
  });
}

export async function getQuoteStatusByKey(key: string) {
  return db.quoteStatus.findUnique({ where: { key } });
}

export async function getDocumentTypeByKey(key: string) {
  return db.documentType.findUnique({ where: { key } });
}

// --- Lead sources ----------------------------------------------------------

export async function createLeadSource(actor: AnyActor, name: string) {
  requirePermission(actor, 'settings.manage');
  const key = slugify(name);
  if (!key) throw new ValidationError('Name is required');
  const last = await db.leadSource.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.leadSource.create({ data: { key, name, position: (last?.position ?? 0) + 1 } });
  await recordAudit({ actor, action: 'leadSource.create', entityType: 'LeadSource', entityId: created.id, metadata: { name } });
  return created;
}

export async function updateLeadSource(
  actor: AnyActor,
  id: string,
  input: { name?: string; isActive?: boolean; position?: number },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.leadSource.update({ where: { id }, data: input });
  await recordAudit({ actor, action: 'leadSource.update', entityType: 'LeadSource', entityId: id, metadata: input });
  return updated;
}

// --- Lost reasons ----------------------------------------------------------

export async function createLostReason(actor: AnyActor, name: string) {
  requirePermission(actor, 'settings.manage');
  const key = slugify(name);
  if (!key) throw new ValidationError('Name is required');
  const last = await db.lostReason.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.lostReason.create({ data: { key, name, position: (last?.position ?? 0) + 1 } });
  await recordAudit({ actor, action: 'lostReason.create', entityType: 'LostReason', entityId: created.id, metadata: { name } });
  return created;
}

export async function updateLostReason(
  actor: AnyActor,
  id: string,
  input: { name?: string; isActive?: boolean; position?: number },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.lostReason.update({ where: { id }, data: input });
  await recordAudit({ actor, action: 'lostReason.update', entityType: 'LostReason', entityId: id, metadata: input });
  return updated;
}

// --- Insurance companies ---------------------------------------------------

export async function createInsuranceCompany(actor: AnyActor, input: { name: string; code?: string }) {
  requirePermission(actor, 'settings.manage');
  if (!input.name.trim()) throw new ValidationError('Name is required');
  const last = await db.insuranceCompany.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.insuranceCompany.create({
    data: { name: input.name.trim(), code: input.code?.trim() || null, position: (last?.position ?? 0) + 1 },
  });
  await recordAudit({
    actor,
    action: 'insuranceCompany.create',
    entityType: 'InsuranceCompany',
    entityId: created.id,
    metadata: { name: input.name },
  });
  return created;
}

export async function updateInsuranceCompany(
  actor: AnyActor,
  id: string,
  input: { name?: string; code?: string | null; isActive?: boolean; position?: number; notes?: string | null },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.insuranceCompany.update({ where: { id }, data: input });
  await recordAudit({
    actor,
    action: 'insuranceCompany.update',
    entityType: 'InsuranceCompany',
    entityId: id,
    metadata: input,
  });
  return updated;
}

// --- Task types ------------------------------------------------------------

export async function createTaskType(
  actor: AnyActor,
  input: { name: string; defaultPriority?: Priority; defaultDueInDays?: number },
) {
  requirePermission(actor, 'settings.manage');
  const key = slugify(input.name);
  if (!key) throw new ValidationError('Name is required');
  const last = await db.taskType.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.taskType.create({
    data: {
      key,
      name: input.name,
      defaultPriority: input.defaultPriority ?? 'NORMAL',
      defaultDueInDays: input.defaultDueInDays ?? 1,
      position: (last?.position ?? 0) + 1,
    },
  });
  await recordAudit({ actor, action: 'taskType.create', entityType: 'TaskType', entityId: created.id, metadata: input });
  return created;
}

export async function updateTaskType(
  actor: AnyActor,
  id: string,
  input: { name?: string; defaultPriority?: Priority; defaultDueInDays?: number; isActive?: boolean; position?: number },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.taskType.update({ where: { id }, data: input });
  await recordAudit({ actor, action: 'taskType.update', entityType: 'TaskType', entityId: id, metadata: input });
  return updated;
}

// --- Quote statuses --------------------------------------------------------

export async function createQuoteStatus(
  actor: AnyActor,
  input: { name: string; isProvided?: boolean; isClosed?: boolean; color?: string },
) {
  requirePermission(actor, 'settings.manage');
  const key = slugify(input.name);
  if (!key) throw new ValidationError('Name is required');
  const last = await db.quoteStatus.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.quoteStatus.create({
    data: {
      key,
      name: input.name,
      isProvided: input.isProvided ?? false,
      isClosed: input.isClosed ?? false,
      color: input.color ?? '#64748b',
      position: (last?.position ?? 0) + 1,
    },
  });
  await recordAudit({ actor, action: 'quoteStatus.create', entityType: 'QuoteStatus', entityId: created.id, metadata: input });
  return created;
}

export async function updateQuoteStatus(
  actor: AnyActor,
  id: string,
  input: { name?: string; isProvided?: boolean; isClosed?: boolean; color?: string; isActive?: boolean; position?: number },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.quoteStatus.update({ where: { id }, data: input });
  await recordAudit({ actor, action: 'quoteStatus.update', entityType: 'QuoteStatus', entityId: id, metadata: input });
  return updated;
}

// --- Document types --------------------------------------------------------

export async function createDocumentType(
  actor: AnyActor,
  input: {
    name: string;
    description?: string;
    extractorKey?: string | null;
    requiredByDefault?: boolean;
    requestTemplate?: string | null;
  },
) {
  requirePermission(actor, 'settings.manage');
  const key = slugify(input.name);
  if (!key) throw new ValidationError('Name is required');
  const last = await db.documentType.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.documentType.create({
    data: {
      key,
      name: input.name,
      description: input.description ?? null,
      extractorKey: input.extractorKey ?? null,
      requiredByDefault: input.requiredByDefault ?? false,
      requestTemplate: input.requestTemplate ?? null,
      position: (last?.position ?? 0) + 1,
    },
  });
  await recordAudit({ actor, action: 'documentType.create', entityType: 'DocumentType', entityId: created.id, metadata: input });
  return created;
}

export async function updateDocumentType(
  actor: AnyActor,
  id: string,
  input: {
    name?: string;
    description?: string | null;
    extractorKey?: string | null;
    requiredByDefault?: boolean;
    requestTemplate?: string | null;
    isActive?: boolean;
    position?: number;
  },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.documentType.update({ where: { id }, data: input });
  await recordAudit({ actor, action: 'documentType.update', entityType: 'DocumentType', entityId: id, metadata: input });
  return updated;
}

// --- Age groups ------------------------------------------------------------

export async function createAgeGroup(
  actor: AnyActor,
  input: { name: string; minAge: number; maxAge: number | null },
) {
  requirePermission(actor, 'settings.manage');
  if (input.maxAge !== null && input.maxAge < input.minAge) {
    throw new ValidationError('Maximum age must be greater than the minimum');
  }
  const last = await db.ageGroup.findFirst({ orderBy: { position: 'desc' } });
  const created = await db.ageGroup.create({
    data: { ...input, position: (last?.position ?? 0) + 1 },
  });
  await recordAudit({ actor, action: 'ageGroup.create', entityType: 'AgeGroup', entityId: created.id, metadata: input });
  return created;
}

export async function updateAgeGroup(
  actor: AnyActor,
  id: string,
  input: { name?: string; minAge?: number; maxAge?: number | null; isActive?: boolean; position?: number },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.ageGroup.update({ where: { id }, data: input });
  await recordAudit({ actor, action: 'ageGroup.update', entityType: 'AgeGroup', entityId: id, metadata: input });
  return updated;
}

export async function deleteAgeGroup(actor: AnyActor, id: string) {
  requirePermission(actor, 'settings.manage');
  await db.ageGroup.delete({ where: { id } });
  await recordAudit({ actor, action: 'ageGroup.delete', entityType: 'AgeGroup', entityId: id });
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export async function listCustomFields(entity?: string) {
  return db.customFieldDefinition.findMany({
    where: { isActive: true, ...(entity ? { entity } : {}) },
    orderBy: [{ entity: 'asc' }, { position: 'asc' }],
  });
}

export async function createCustomField(
  actor: AnyActor,
  input: {
    entity: string;
    label: string;
    fieldType?: string;
    options?: string[];
    required?: boolean;
    helpText?: string;
  },
) {
  requirePermission(actor, 'settings.manage');
  const key = slugify(input.label);
  if (!key) throw new ValidationError('Label is required');

  const existing = await db.customFieldDefinition.findUnique({
    where: { entity_key: { entity: input.entity, key } },
  });
  if (existing) throw new ConflictError(`A field named "${input.label}" already exists on ${input.entity}`);

  const last = await db.customFieldDefinition.findFirst({
    where: { entity: input.entity },
    orderBy: { position: 'desc' },
  });

  const created = await db.customFieldDefinition.create({
    data: {
      entity: input.entity,
      key,
      label: input.label,
      fieldType: input.fieldType ?? 'text',
      options: (input.options ?? []) as object,
      required: input.required ?? false,
      helpText: input.helpText ?? null,
      position: (last?.position ?? 0) + 1,
    },
  });

  await recordAudit({
    actor,
    action: 'customField.create',
    entityType: 'CustomFieldDefinition',
    entityId: created.id,
    metadata: input,
  });
  invalidateSettingsCache();
  return created;
}

export async function updateCustomField(
  actor: AnyActor,
  id: string,
  input: {
    label?: string;
    fieldType?: string;
    options?: string[];
    required?: boolean;
    helpText?: string | null;
    isActive?: boolean;
    position?: number;
  },
) {
  requirePermission(actor, 'settings.manage');
  const updated = await db.customFieldDefinition.update({
    where: { id },
    data: { ...input, options: input.options ? (input.options as object) : undefined },
  });
  await recordAudit({
    actor,
    action: 'customField.update',
    entityType: 'CustomFieldDefinition',
    entityId: id,
    metadata: input,
  });
  return updated;
}
