import { z } from 'zod';
import { normalizePhone } from '@/lib/utils';

/**
 * Validation schemas for client data.
 *
 * These are the single definition of what a valid client/driver/vehicle looks
 * like. API routes, server actions and forms all validate against them, so a
 * new field is added in one place.
 */

const optionalString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .nullable()
  .transform((v) => (v === '' ? null : (v ?? null)));

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .transform((v) => {
    if (!v) return null;
    const d = typeof v === 'string' ? new Date(v) : v;
    return Number.isNaN(d.getTime()) ? null : d;
  });

const optionalInt = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  });

export const phoneSchema = z
  .string()
  .min(7, 'Phone number is too short')
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
      return z.NEVER;
    }
    return normalized;
  });

export const clientCreateSchema = z.object({
  firstName: optionalString,
  lastName: optionalString,
  displayName: optionalString,
  email: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : (v ?? null))),
  phone: phoneSchema,
  altPhone: optionalString,
  dateOfBirth: optionalDate,
  maritalStatus: optionalString,
  preferredLanguage: z.string().default('en'),

  addressLine1: optionalString,
  addressLine2: optionalString,
  city: optionalString,
  province: optionalString,
  postalCode: optionalString,
  country: optionalString,

  stageId: z.string().optional(),
  leadSourceId: optionalString,
  assignedUserId: optionalString,
  products: z.array(z.string()).default(['auto']),
  tags: z.array(z.string()).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export type ClientCreateInput = z.input<typeof clientCreateSchema>;

export const clientUpdateSchema = clientCreateSchema.partial().extend({
  phone: phoneSchema.optional(),
  lostReasonId: optionalString,
  lostNotes: optionalString,
  isArchived: z.boolean().optional(),
});

export type ClientUpdateInput = z.input<typeof clientUpdateSchema>;

export const driverSchema = z.object({
  firstName: optionalString,
  lastName: optionalString,
  fullName: z.string().trim().min(1, 'Driver name is required').max(255),
  relationship: optionalString,
  isPrimary: z.boolean().default(false),
  dateOfBirth: optionalDate,
  gender: optionalString,
  maritalStatus: optionalString,

  licenceNumber: optionalString,
  licenceClass: optionalString,
  licenceProvince: optionalString,
  licenceExpiry: optionalDate,
  g1Date: optionalDate,
  g2Date: optionalDate,
  gDate: optionalDate,
  driverTraining: z.boolean().default(false),
  driverTrainingDate: optionalDate,
  yearsLicensed: optionalInt,
  internationalExperienceYears: optionalInt,
  internationalExperienceCountry: optionalString,
  occupation: optionalString,
  notes: optionalString,
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export type DriverInput = z.input<typeof driverSchema>;

export const convictionSchema = z.object({
  description: z.string().trim().min(1).max(500),
  severity: z.enum(['minor', 'major', 'criminal']).default('minor'),
  convictionDate: optionalDate,
});

export const claimSchema = z.object({
  description: z.string().trim().min(1).max(500),
  claimDate: optionalDate,
  faultType: z.enum(['at_fault', 'not_at_fault', 'partial', 'comprehensive']).default('not_at_fault'),
  amount: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }),
});

export const vehicleSchema = z.object({
  vin: optionalString.refine(
    (v) => !v || /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(v),
    'A VIN is 17 characters and cannot contain I, O or Q',
  ),
  year: optionalInt,
  make: optionalString,
  model: optionalString,
  trim: optionalString,
  plate: optionalString,
  ownership: optionalString,
  usage: optionalString,
  annualKilometres: optionalInt,
  commuteOneWayKm: optionalInt,
  winterTires: z.boolean().default(false),
  antiTheftDevice: z.boolean().default(false),
  purchaseDate: optionalDate,
  purchaseCondition: optionalString,
  lienholder: optionalString,
  primaryDriverId: optionalString,
  notes: optionalString,
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export type VehicleInput = z.input<typeof vehicleSchema>;

export const clientSearchSchema = z.object({
  query: z.string().trim().optional(),
  stageIds: z.array(z.string()).optional(),
  assignedUserIds: z.array(z.string()).optional(),
  leadSourceIds: z.array(z.string()).optional(),
  insuranceCompanyIds: z.array(z.string()).optional(),
  policyStatuses: z.array(z.string()).optional(),
  quoteStatusIds: z.array(z.string()).optional(),
  followUpStatus: z.enum(['due_today', 'overdue', 'upcoming', 'none']).optional(),
  ageGroupIds: z.array(z.string()).optional(),
  createdFrom: optionalDate,
  createdTo: optionalDate,
  needsAttention: z.boolean().optional(),
  hasUnread: z.boolean().optional(),
  includeArchived: z.boolean().default(false),
  sort: z.enum(['recent', 'created', 'name', 'stage']).default('recent'),
  take: z.number().int().min(1).max(200).default(50),
  skip: z.number().int().min(0).default(0),
});

export type ClientSearchInput = z.input<typeof clientSearchSchema>;
export type ClientSearchParams = z.output<typeof clientSearchSchema>;
