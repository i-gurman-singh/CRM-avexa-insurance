import '@/lib/server-guard';
import { db, type DbClient } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { log, maskPhone } from '@/lib/logger';
import type { Prisma } from '@/lib/types';
import { calculateAge, formatPhone } from '@/lib/utils';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { changedFields, recordAudit } from '@/core/audit/service';
import { actorUserId, requirePermission, SYSTEM_ACTOR, type AnyActor } from '@/core/context';
import { getDefaultStage } from '@/core/settings/lookups';
import { recordProvenance } from './provenance';
import {
  claimSchema,
  clientCreateSchema,
  clientSearchSchema,
  clientUpdateSchema,
  convictionSchema,
  driverSchema,
  vehicleSchema,
  type ClientSearchInput,
} from './schemas';

const logger = log('clients');

/**
 * Client records: the centre of the CRM.
 *
 * A "client" covers the whole lifecycle from unqualified lead to bound policy —
 * there is no separate Lead entity, because in this business a lead becomes a
 * client without changing identity, and splitting them would mean migrating
 * conversations and documents at the exact moment staff least want friction.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const clientListInclude = {
  stage: true,
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
  leadSource: true,
  _count: { select: { quotes: true, documents: true, tasks: true } },
} satisfies Prisma.ClientInclude;

export async function getClient(id: string) {
  return db.client.findUnique({
    where: { id },
    include: {
      stage: true,
      assignedUser: { select: { id: true, name: true, email: true, avatarUrl: true } },
      leadSource: true,
      lostReason: true,
      drivers: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        include: { convictions: true, claims: true },
      },
      vehicles: { orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function getClientOrThrow(id: string) {
  const client = await getClient(id);
  if (!client) throw new NotFoundError('Client');
  return client;
}

export async function findClientByPhone(phone: string, client: DbClient = db) {
  return client.client.findUnique({ where: { phone } });
}

/**
 * Search and filter.
 *
 * Deliberately built on indexed columns and simple `contains` matching rather
 * than full-text search: at brokerage scale this is fast, predictable, and one
 * less piece of infrastructure. If the client table ever passes ~100k rows,
 * add a Postgres tsvector column here — no caller has to change.
 */
export async function searchClients(rawInput: ClientSearchInput = {}) {
  const input = clientSearchSchema.parse(rawInput);
  const q = input.query?.trim();

  const and: Prisma.ClientWhereInput[] = [];

  if (!input.includeArchived) and.push({ isArchived: false });

  if (q) {
    const digits = q.replace(/\D/g, '');
    and.push({
      OR: [
        { displayName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        // Cross-entity search: licence number, VIN, policy number.
        { drivers: { some: { licenceNumber: { contains: q, mode: 'insensitive' as const } } } },
        { drivers: { some: { fullName: { contains: q, mode: 'insensitive' as const } } } },
        { vehicles: { some: { vin: { contains: q, mode: 'insensitive' as const } } } },
        { vehicles: { some: { plate: { contains: q, mode: 'insensitive' as const } } } },
        { vehicles: { some: { make: { contains: q, mode: 'insensitive' as const } } } },
        { vehicles: { some: { model: { contains: q, mode: 'insensitive' as const } } } },
        { policies: { some: { policyNumber: { contains: q, mode: 'insensitive' as const } } } },
        { policies: { some: { insuranceCompany: { name: { contains: q, mode: 'insensitive' as const } } } } },
        { quotes: { some: { insuranceCompany: { name: { contains: q, mode: 'insensitive' as const } } } } },
        { stage: { name: { contains: q, mode: 'insensitive' as const } } },
      ],
    });
  }

  if (input.stageIds?.length) and.push({ stageId: { in: input.stageIds } });
  if (input.assignedUserIds?.length) and.push({ assignedUserId: { in: input.assignedUserIds } });
  if (input.leadSourceIds?.length) and.push({ leadSourceId: { in: input.leadSourceIds } });
  if (input.needsAttention) and.push({ needsAttention: true });
  if (input.hasUnread) and.push({ unreadCount: { gt: 0 } });

  if (input.insuranceCompanyIds?.length) {
    and.push({
      OR: [
        { quotes: { some: { insuranceCompanyId: { in: input.insuranceCompanyIds } } } },
        { policies: { some: { insuranceCompanyId: { in: input.insuranceCompanyIds } } } },
      ],
    });
  }

  if (input.quoteStatusIds?.length) {
    and.push({ quotes: { some: { statusId: { in: input.quoteStatusIds } } } });
  }

  if (input.policyStatuses?.length) {
    and.push({ policies: { some: { status: { in: input.policyStatuses as never } } } });
  }

  if (input.createdFrom || input.createdTo) {
    and.push({
      createdAt: {
        ...(input.createdFrom ? { gte: input.createdFrom } : {}),
        ...(input.createdTo ? { lte: input.createdTo } : {}),
      },
    });
  }

  if (input.ageGroupIds?.length) {
    const groups = await db.ageGroup.findMany({ where: { id: { in: input.ageGroupIds } } });
    const ranges = groups.map((g) => dateRangeForAges(g.minAge, g.maxAge));
    if (ranges.length) {
      and.push({ OR: ranges.map((r) => ({ dateOfBirth: { gte: r.from, lte: r.to } })) });
    }
  }

  if (input.followUpStatus && input.followUpStatus !== 'none') {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const dueFilter =
      input.followUpStatus === 'overdue'
        ? { lt: now }
        : input.followUpStatus === 'due_today'
          ? { lte: endOfToday, gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
          : { gt: endOfToday };

    and.push({ followUps: { some: { status: 'SCHEDULED', dueAt: dueFilter } } });
  } else if (input.followUpStatus === 'none') {
    and.push({ followUps: { none: { status: 'SCHEDULED' } } });
  }

  const where: Prisma.ClientWhereInput = and.length ? { AND: and } : {};

  const orderBy: Prisma.ClientOrderByWithRelationInput =
    input.sort === 'created'
      ? { createdAt: 'desc' }
      : input.sort === 'name'
        ? { displayName: 'asc' }
        : input.sort === 'stage'
          ? { stage: { position: 'asc' } }
          : { lastActivityAt: 'desc' };

  const [items, total] = await Promise.all([
    db.client.findMany({ where, orderBy, take: input.take, skip: input.skip, include: clientListInclude }),
    db.client.count({ where }),
  ]);

  return { items, total, take: input.take, skip: input.skip };
}

function dateRangeForAges(minAge: number, maxAge: number | null) {
  const now = new Date();
  // Someone who is `minAge` was born at most `minAge` years ago.
  const to = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
  const from = maxAge === null
    ? new Date(1900, 0, 1)
    : new Date(now.getFullYear() - maxAge - 1, now.getMonth(), now.getDate() + 1);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateClientOptions {
  /** Skip the permission check — used by the inbound WhatsApp path. */
  system?: boolean;
  source?: 'manual' | 'whatsapp' | 'import';
}

export async function createClient(
  actor: AnyActor,
  rawInput: unknown,
  opts: CreateClientOptions = {},
  client: DbClient = db,
) {
  if (!opts.system) requirePermission(actor, 'clients.create');

  const input = clientCreateSchema.parse(rawInput);

  const existing = await client.client.findUnique({ where: { phone: input.phone } });
  if (existing) {
    throw new ConflictError('A client with this phone number already exists', {
      clientId: existing.id,
    });
  }

  const stageId = input.stageId ?? (await getDefaultStage()).id;

  const displayName =
    input.displayName?.trim() ||
    [input.firstName, input.lastName].filter(Boolean).join(' ').trim() ||
    formatPhone(input.phone);

  const created = await client.client.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      displayName,
      email: input.email,
      phone: input.phone,
      altPhone: input.altPhone,
      dateOfBirth: input.dateOfBirth,
      maritalStatus: input.maritalStatus,
      preferredLanguage: input.preferredLanguage,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      country: input.country ?? 'CA',
      stageId,
      leadSourceId: input.leadSourceId,
      assignedUserId: input.assignedUserId,
      createdByUserId: actorUserId(actor),
      products: input.products,
      tags: input.tags,
      customFields: input.customFields as object,
    },
    include: { stage: true },
  });

  await client.clientStageHistory.create({
    data: {
      clientId: created.id,
      toStageId: stageId,
      changedByUserId: actorUserId(actor),
      changedBy: opts.source === 'whatsapp' ? 'system' : 'manual',
      reason: opts.source === 'whatsapp' ? 'New inbound WhatsApp conversation' : 'Client created',
    },
  });

  await recordActivity(
    {
      clientId: created.id,
      type: ACTIVITY_TYPES.CLIENT_CREATED,
      title: opts.source === 'whatsapp' ? 'Lead created from WhatsApp' : 'Lead created',
      metadata: { source: opts.source ?? 'manual', stage: created.stage.name },
      actor,
      actorType: opts.source === 'whatsapp' ? 'system' : undefined,
    },
    client,
  );

  await recordAudit({
    actor,
    action: 'client.create',
    entityType: 'Client',
    entityId: created.id,
    metadata: { source: opts.source ?? 'manual' },
  });

  logger.info({ clientId: created.id, phone: maskPhone(created.phone) }, 'Client created');
  return created;
}

/**
 * Find the client behind a phone number, creating one if we have not seen it.
 * This is the entry point for inbound WhatsApp.
 */
export async function findOrCreateClientByPhone(
  phone: string,
  opts: { profileName?: string; leadSourceKey?: string } = {},
  client: DbClient = db,
): Promise<{ client: Awaited<ReturnType<typeof createClient>>; created: boolean }> {
  const existing = await client.client.findUnique({ where: { phone }, include: { stage: true } });
  if (existing) return { client: existing, created: false };

  const leadSource = opts.leadSourceKey
    ? await client.leadSource.findUnique({ where: { key: opts.leadSourceKey } })
    : await client.leadSource.findUnique({ where: { key: 'whatsapp_direct' } });

  const created = await createClient(
    SYSTEM_ACTOR,
    {
      phone,
      displayName: opts.profileName?.trim() || undefined,
      leadSourceId: leadSource?.id ?? null,
    },
    { system: true, source: 'whatsapp' },
    client,
  );

  return { client: created, created: true };
}

export async function updateClient(actor: AnyActor, id: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');

  const input = clientUpdateSchema.parse(rawInput);
  const existing = await db.client.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Client');

  if (input.phone && input.phone !== existing.phone) {
    const clash = await db.client.findUnique({ where: { phone: input.phone } });
    if (clash) throw new ConflictError('Another client already uses that phone number');
  }

  const data: Prisma.ClientUpdateInput = {};
  const assignable = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'altPhone',
    'dateOfBirth',
    'maritalStatus',
    'preferredLanguage',
    'addressLine1',
    'addressLine2',
    'city',
    'province',
    'postalCode',
    'country',
    'lostNotes',
    'isArchived',
  ] as const;

  for (const key of assignable) {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  }

  if (input.products !== undefined) data.products = input.products;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.customFields !== undefined) data.customFields = input.customFields as object;
  if (input.leadSourceId !== undefined) {
    data.leadSource = input.leadSourceId ? { connect: { id: input.leadSourceId } } : { disconnect: true };
  }
  if (input.lostReasonId !== undefined) {
    data.lostReason = input.lostReasonId ? { connect: { id: input.lostReasonId } } : { disconnect: true };
  }

  // Keep displayName coherent when the name parts change.
  const nextFirst = input.firstName !== undefined ? input.firstName : existing.firstName;
  const nextLast = input.lastName !== undefined ? input.lastName : existing.lastName;
  if (input.displayName !== undefined && input.displayName) {
    data.displayName = input.displayName;
  } else if (input.firstName !== undefined || input.lastName !== undefined) {
    const composed = [nextFirst, nextLast].filter(Boolean).join(' ').trim();
    if (composed) data.displayName = composed;
  }

  data.lastActivityAt = new Date();

  const updated = await db.client.update({ where: { id }, data, include: { stage: true } });

  const fields = changedFields(existing as unknown as Record<string, unknown>, data as Record<string, unknown>);

  // Anything a human types is, by definition, manually entered.
  for (const field of fields) {
    if (field === 'lastActivityAt') continue;
    await recordProvenance({
      entityType: 'client',
      entityId: id,
      fieldPath: field,
      source: 'MANUAL',
      sourceRef: actorUserId(actor),
      previousValue: (existing as Record<string, unknown>)[field],
      currentValue: (data as Record<string, unknown>)[field],
      verifiedBy: actor,
    });
  }

  if (fields.filter((f) => f !== 'lastActivityAt').length) {
    await recordActivity({
      clientId: id,
      type: ACTIVITY_TYPES.CLIENT_UPDATED,
      title: 'Client details updated',
      metadata: { fields: fields.filter((f) => f !== 'lastActivityAt') },
      actor,
    });
  }

  await recordAudit({
    actor,
    action: 'client.update',
    entityType: 'Client',
    entityId: id,
    metadata: { changedFields: fields },
  });

  return updated;
}

export async function assignClient(actor: AnyActor, id: string, userId: string | null) {
  requirePermission(actor, 'clients.assign');

  const updated = await db.client.update({
    where: { id },
    data: { assignedUserId: userId, lastActivityAt: new Date() },
    include: { assignedUser: { select: { id: true, name: true } } },
  });

  await recordActivity({
    clientId: id,
    type: ACTIVITY_TYPES.CLIENT_ASSIGNED,
    title: updated.assignedUser ? `Assigned to ${updated.assignedUser.name}` : 'Unassigned',
    actor,
  });

  await recordAudit({ actor, action: 'client.assign', entityType: 'Client', entityId: id, metadata: { userId } });
  return updated;
}

export async function archiveClient(actor: AnyActor, id: string, archived: boolean) {
  requirePermission(actor, 'clients.delete');
  const updated = await db.client.update({ where: { id }, data: { isArchived: archived } });
  await recordAudit({
    actor,
    action: archived ? 'client.archive' : 'client.restore',
    entityType: 'Client',
    entityId: id,
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export async function addDriver(actor: AnyActor, clientId: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');
  const input = driverSchema.parse(rawInput);

  const driver = await db.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.driver.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }
    return tx.driver.create({
      data: { ...input, clientId, customFields: input.customFields as object },
    });
  });

  await recordActivity({
    clientId,
    type: 'driver.added',
    title: `Driver added: ${driver.fullName}`,
    actor,
    entityType: 'Driver',
    entityId: driver.id,
  });
  await recordAudit({ actor, action: 'driver.create', entityType: 'Driver', entityId: driver.id, metadata: { clientId } });
  return driver;
}

export async function updateDriver(actor: AnyActor, driverId: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');
  const input = driverSchema.partial().parse(rawInput);

  const existing = await db.driver.findUnique({ where: { id: driverId } });
  if (!existing) throw new NotFoundError('Driver');

  const updated = await db.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.driver.updateMany({ where: { clientId: existing.clientId }, data: { isPrimary: false } });
    }
    return tx.driver.update({
      where: { id: driverId },
      data: { ...input, customFields: input.customFields ? (input.customFields as object) : undefined },
    });
  });

  const fields = changedFields(
    existing as unknown as Record<string, unknown>,
    input as Record<string, unknown>,
  );
  for (const field of fields) {
    await recordProvenance({
      entityType: 'driver',
      entityId: driverId,
      fieldPath: field,
      source: 'MANUAL',
      sourceRef: actorUserId(actor),
      previousValue: (existing as Record<string, unknown>)[field],
      currentValue: (input as Record<string, unknown>)[field],
      verifiedBy: actor,
    });
  }

  await recordAudit({
    actor,
    action: 'driver.update',
    entityType: 'Driver',
    entityId: driverId,
    metadata: { changedFields: fields },
  });
  return updated;
}

export async function deleteDriver(actor: AnyActor, driverId: string) {
  requirePermission(actor, 'clients.update');
  const driver = await db.driver.delete({ where: { id: driverId } });
  await recordActivity({
    clientId: driver.clientId,
    type: 'driver.removed',
    title: `Driver removed: ${driver.fullName}`,
    actor,
  });
  await recordAudit({ actor, action: 'driver.delete', entityType: 'Driver', entityId: driverId });
  return driver;
}

export async function addConviction(actor: AnyActor, driverId: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');
  const input = convictionSchema.parse(rawInput);
  return db.driverConviction.create({ data: { ...input, driverId } });
}

export async function deleteConviction(actor: AnyActor, id: string) {
  requirePermission(actor, 'clients.update');
  return db.driverConviction.delete({ where: { id } });
}

export async function addClaim(actor: AnyActor, driverId: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');
  const input = claimSchema.parse(rawInput);
  return db.driverClaim.create({ data: { ...input, driverId } });
}

export async function deleteClaim(actor: AnyActor, id: string) {
  requirePermission(actor, 'clients.update');
  return db.driverClaim.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export async function addVehicle(actor: AnyActor, clientId: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');
  const input = vehicleSchema.parse(rawInput);

  const vehicle = await db.vehicle.create({
    data: { ...input, clientId, customFields: input.customFields as object },
  });

  await recordActivity({
    clientId,
    type: 'vehicle.added',
    title: `Vehicle added: ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unnamed vehicle'}`,
    actor,
    entityType: 'Vehicle',
    entityId: vehicle.id,
  });
  await recordAudit({ actor, action: 'vehicle.create', entityType: 'Vehicle', entityId: vehicle.id, metadata: { clientId } });
  return vehicle;
}

export async function updateVehicle(actor: AnyActor, vehicleId: string, rawInput: unknown) {
  requirePermission(actor, 'clients.update');
  const input = vehicleSchema.partial().parse(rawInput);

  const existing = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!existing) throw new NotFoundError('Vehicle');

  const updated = await db.vehicle.update({
    where: { id: vehicleId },
    data: { ...input, customFields: input.customFields ? (input.customFields as object) : undefined },
  });

  const fields = changedFields(
    existing as unknown as Record<string, unknown>,
    input as Record<string, unknown>,
  );
  for (const field of fields) {
    await recordProvenance({
      entityType: 'vehicle',
      entityId: vehicleId,
      fieldPath: field,
      source: 'MANUAL',
      sourceRef: actorUserId(actor),
      previousValue: (existing as Record<string, unknown>)[field],
      currentValue: (input as Record<string, unknown>)[field],
      verifiedBy: actor,
    });
  }

  await recordAudit({
    actor,
    action: 'vehicle.update',
    entityType: 'Vehicle',
    entityId: vehicleId,
    metadata: { changedFields: fields },
  });
  return updated;
}

export async function deleteVehicle(actor: AnyActor, vehicleId: string) {
  requirePermission(actor, 'clients.update');
  const vehicle = await db.vehicle.delete({ where: { id: vehicleId } });
  await recordAudit({ actor, action: 'vehicle.delete', entityType: 'Vehicle', entityId: vehicleId });
  return vehicle;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listNotes(clientId: string) {
  return db.note.findMany({
    where: { clientId },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });
}

export async function addNote(actor: AnyActor, clientId: string, body: string, isPinned = false) {
  requirePermission(actor, 'notes.create');
  const trimmed = body.trim();
  if (!trimmed) throw new ConflictError('Note cannot be empty');

  const note = await db.note.create({
    data: { clientId, body: trimmed, isPinned, authorId: actorUserId(actor) },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  await recordActivity({
    clientId,
    type: ACTIVITY_TYPES.NOTE_ADDED,
    title: 'Internal note added',
    body: trimmed.slice(0, 200),
    actor,
    entityType: 'Note',
    entityId: note.id,
  });

  return note;
}

export async function toggleNotePin(actor: AnyActor, noteId: string, isPinned: boolean) {
  requirePermission(actor, 'notes.create');
  return db.note.update({ where: { id: noteId }, data: { isPinned } });
}

export async function deleteNote(actor: AnyActor, noteId: string) {
  requirePermission(actor, 'notes.delete');
  const note = await db.note.delete({ where: { id: noteId } });
  await recordAudit({ actor, action: 'note.delete', entityType: 'Note', entityId: noteId });
  return note;
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** Client age from date of birth; null when unknown. */
export function clientAge(client: { dateOfBirth: Date | null }): number | null {
  return calculateAge(client.dateOfBirth);
}

/** Flag or clear the "needs attention" state shown on the dashboard. */
export async function setNeedsAttention(
  clientId: string,
  needsAttention: boolean,
  reason?: string | null,
  client: DbClient = db,
) {
  await client.client.update({
    where: { id: clientId },
    data: { needsAttention, attentionReason: needsAttention ? (reason ?? null) : null },
  });
}
