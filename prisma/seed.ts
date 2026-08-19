/**
 * Database seed.
 *
 *   npm run db:seed
 *
 * Two parts:
 *
 *  1. Reference data — pipeline stages, insurance companies, document types,
 *     task types, quote statuses, lead sources, lost reasons, age groups.
 *     This is the configuration the CRM needs to function at all, and it is
 *     idempotent: running the seed again updates rather than duplicates.
 *
 *  2. Demo data — a handful of realistic clients at different pipeline stages,
 *     with conversations, quotes, documents and tasks, so the dashboard and
 *     analytics have something to show on day one. Skipped in production
 *     unless SEED_DEMO=true, and easy to delete afterwards (every demo client
 *     is tagged "demo").
 */
// Must be first: loads .env so `npm run db:seed` works without a wrapper.
import '../src/lib/load-env';

import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const SEED_DEMO = process.env.SEED_DEMO !== 'false' && process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const STAGES = [
  { key: 'new_lead', name: 'New Lead', category: 'OPEN', color: '#0ea5e9', isDefault: true, staleAfterHours: 4 },
  { key: 'quote_requested', name: 'Quote Requested', category: 'OPEN', color: '#6366f1', staleAfterHours: 24 },
  { key: 'quoting', name: 'Quoting', category: 'OPEN', color: '#8b5cf6', staleAfterHours: 24 },
  { key: 'quote_provided', name: 'Quote Provided', category: 'OPEN', color: '#a855f7', staleAfterHours: 48 },
  { key: 'follow_up_required', name: 'Follow-Up Required', category: 'OPEN', color: '#f59e0b', staleAfterHours: 24 },
  { key: 'interested', name: 'Interested', category: 'OPEN', color: '#eab308', staleAfterHours: 48 },
  { key: 'ready_to_bind', name: 'Ready to Bind', category: 'OPEN', color: '#22c55e', staleAfterHours: 4 },
  { key: 'documents_requested', name: 'Documents Requested', category: 'OPEN', color: '#14b8a6', staleAfterHours: 48 },
  { key: 'documents_received', name: 'Documents Received', category: 'OPEN', color: '#06b6d4', staleAfterHours: 24 },
  { key: 'binding_processing', name: 'Binding / Processing', category: 'OPEN', color: '#3b82f6', staleAfterHours: 24 },
  { key: 'policy_completed', name: 'Policy Completed', category: 'WON', color: '#16a34a' },
  { key: 'lost', name: 'Lost / Not Interested', category: 'LOST', color: '#ef4444' },
  { key: 'future_follow_up', name: 'Future Follow-Up', category: 'DORMANT', color: '#94a3b8' },
] as const;

const LEAD_SOURCES = [
  { key: 'facebook', name: 'Facebook' },
  { key: 'instagram', name: 'Instagram' },
  { key: 'whatsapp_direct', name: 'WhatsApp Direct' },
  { key: 'referral', name: 'Referral' },
  { key: 'existing_client', name: 'Existing Client' },
  { key: 'website', name: 'Website' },
  { key: 'google', name: 'Google Search' },
  { key: 'walk_in', name: 'Walk-in' },
  { key: 'other', name: 'Other' },
];

const LOST_REASONS = [
  { key: 'price_too_high', name: 'Price too high' },
  { key: 'bought_elsewhere', name: 'Bought elsewhere' },
  { key: 'no_response', name: 'No response' },
  { key: 'not_eligible', name: 'Not eligible' },
  { key: 'changed_mind', name: 'Changed mind' },
  { key: 'duplicate', name: 'Duplicate record' },
  { key: 'other', name: 'Other' },
];

const INSURANCE_COMPANIES = [
  { name: 'Aviva', code: 'AVIVA' },
  { name: 'Intact', code: 'INTACT' },
  { name: 'Pembridge', code: 'PEMB' },
  { name: 'Echelon', code: 'ECH' },
  { name: 'Economical', code: 'ECON' },
  { name: 'Wawanesa', code: 'WAW' },
  { name: 'Gore Mutual', code: 'GORE' },
  { name: 'Travelers', code: 'TRAV' },
];

const DOCUMENT_TYPES = [
  {
    key: 'drivers_licence',
    name: "Driver's Licence",
    extractorKey: 'drivers_licence',
    requiredByDefault: true,
    description: 'Front of the provincial driver licence for each listed driver.',
    requestTemplate:
      "To start your quote, could you send a clear photo of your driver's licence? You can take it right here in this chat.",
  },
  {
    key: 'vehicle_ownership',
    name: 'Vehicle Ownership',
    extractorKey: 'vehicle_ownership',
    requiredByDefault: true,
    description: 'Vehicle registration / ownership permit showing the VIN.',
    requestTemplate:
      'Could you also send a photo of your vehicle ownership (the permit with the VIN on it)?',
  },
  {
    key: 'void_cheque',
    name: 'Void Cheque',
    extractorKey: 'void_cheque',
    requiredByDefault: true,
    description: 'Void cheque or direct-deposit form for monthly payments.',
    requestTemplate:
      'For monthly payments we need a void cheque or a direct-deposit form from your bank app.',
  },
  {
    key: 'winter_tire_photo',
    name: 'Winter Tire Photo',
    extractorKey: 'winter_tire_photo',
    requiredByDefault: false,
    description: 'Photo of the tire sidewall or the purchase invoice, for the winter tire discount.',
    requestTemplate:
      'If you have winter tires, send a photo of the sidewall or your invoice and we can apply the discount.',
  },
  {
    key: 'driver_training',
    name: 'Driver Training Certificate',
    extractorKey: 'driver_training',
    requiredByDefault: false,
    description: 'Ministry-approved beginner driver education certificate.',
    requestTemplate: 'If you completed driver training, send the certificate and we can apply the discount.',
  },
  {
    key: 'prior_insurance',
    name: 'Prior Insurance Document',
    extractorKey: 'prior_insurance',
    requiredByDefault: false,
    description: 'Declaration page, pink slip, or letter of experience from your previous insurer.',
    requestTemplate:
      'Do you have your previous insurance documents? A photo of the pink slip or declaration page is perfect.',
  },
  {
    key: 'signed_application',
    name: 'Signed Application',
    extractorKey: null,
    requiredByDefault: false,
    description: 'The insurance application signed by the client.',
    requestTemplate: null,
  },
  {
    key: 'policy_documents',
    name: 'Policy Documents',
    extractorKey: null,
    requiredByDefault: false,
    description: 'Issued policy documents from the insurer.',
    requestTemplate: null,
  },
  {
    key: 'other_document',
    name: 'Other Document',
    extractorKey: 'generic',
    requiredByDefault: false,
    description: 'Anything else the client sends.',
    requestTemplate: null,
  },
];

const TASK_TYPES = [
  { key: 'call_client', name: 'Call client', defaultPriority: 'HIGH', defaultDueInDays: 1 },
  { key: 'prepare_quote', name: 'Prepare quote', defaultPriority: 'HIGH', defaultDueInDays: 1 },
  { key: 'request_documents', name: 'Request documents', defaultPriority: 'NORMAL', defaultDueInDays: 1 },
  { key: 'request_licence', name: 'Request licence', defaultPriority: 'NORMAL', defaultDueInDays: 1 },
  { key: 'request_ownership', name: 'Request ownership', defaultPriority: 'NORMAL', defaultDueInDays: 1 },
  { key: 'request_void_cheque', name: 'Request void cheque', defaultPriority: 'NORMAL', defaultDueInDays: 2 },
  { key: 'send_quote', name: 'Send quote', defaultPriority: 'HIGH', defaultDueInDays: 1 },
  { key: 'check_alternative_company', name: 'Check alternative company', defaultPriority: 'HIGH', defaultDueInDays: 1 },
  { key: 'request_approval', name: 'Request approval', defaultPriority: 'NORMAL', defaultDueInDays: 2 },
  { key: 'follow_up', name: 'Follow up', defaultPriority: 'NORMAL', defaultDueInDays: 3 },
  { key: 'bind_policy', name: 'Bind policy', defaultPriority: 'URGENT', defaultDueInDays: 1 },
  { key: 'send_documents_for_signature', name: 'Send documents for signature', defaultPriority: 'HIGH', defaultDueInDays: 1 },
  { key: 'confirm_payment', name: 'Confirm payment', defaultPriority: 'HIGH', defaultDueInDays: 1 },
  { key: 'complete_policy', name: 'Complete policy', defaultPriority: 'HIGH', defaultDueInDays: 2 },
  { key: 'update_client_information', name: 'Update client information', defaultPriority: 'NORMAL', defaultDueInDays: 1 },
];

const QUOTE_STATUSES = [
  { key: 'draft', name: 'Draft', color: '#94a3b8' },
  { key: 'awaiting_underwriting', name: 'Awaiting underwriting', color: '#f59e0b' },
  { key: 'provided', name: 'Provided to client', isProvided: true, color: '#6366f1' },
  { key: 'accepted', name: 'Accepted', isProvided: true, isClosed: true, color: '#22c55e' },
  { key: 'declined', name: 'Declined by client', isProvided: true, isClosed: true, color: '#ef4444' },
  { key: 'expired', name: 'Expired', isClosed: true, color: '#64748b' },
];

const AGE_GROUPS = [
  { name: 'Under 21', minAge: 0, maxAge: 20 },
  { name: '21–25', minAge: 21, maxAge: 25 },
  { name: '26–30', minAge: 26, maxAge: 30 },
  { name: '31–40', minAge: 31, maxAge: 40 },
  { name: '41–50', minAge: 41, maxAge: 50 },
  { name: '51–60', minAge: 51, maxAge: 60 },
  { name: '60+', minAge: 61, maxAge: null },
];

async function seedReferenceData() {
  console.log('Seeding reference data…');

  for (const [index, stage] of STAGES.entries()) {
    await db.pipelineStage.upsert({
      where: { key: stage.key },
      create: {
        key: stage.key,
        name: stage.name,
        category: stage.category,
        color: stage.color,
        position: index + 1,
        isDefault: 'isDefault' in stage ? stage.isDefault : false,
        staleAfterHours: 'staleAfterHours' in stage ? stage.staleAfterHours : null,
      },
      update: { name: stage.name, category: stage.category, color: stage.color, position: index + 1 },
    });
  }

  for (const [index, source] of LEAD_SOURCES.entries()) {
    await db.leadSource.upsert({
      where: { key: source.key },
      create: { ...source, position: index + 1 },
      update: { name: source.name, position: index + 1 },
    });
  }

  for (const [index, reason] of LOST_REASONS.entries()) {
    await db.lostReason.upsert({
      where: { key: reason.key },
      create: { ...reason, position: index + 1 },
      update: { name: reason.name, position: index + 1 },
    });
  }

  for (const [index, company] of INSURANCE_COMPANIES.entries()) {
    await db.insuranceCompany.upsert({
      where: { name: company.name },
      create: { ...company, position: index + 1 },
      update: { code: company.code, position: index + 1 },
    });
  }

  for (const [index, type] of DOCUMENT_TYPES.entries()) {
    const documentType = await db.documentType.upsert({
      where: { key: type.key },
      create: { ...type, position: index + 1 },
      update: {
        name: type.name,
        description: type.description,
        extractorKey: type.extractorKey,
        requiredByDefault: type.requiredByDefault,
        requestTemplate: type.requestTemplate,
        position: index + 1,
      },
    });

    // Auto requirements: licence, ownership and void cheque are mandatory.
    if (type.requiredByDefault) {
      await db.documentRequirement.upsert({
        where: { documentTypeId_productKey: { documentTypeId: documentType.id, productKey: 'auto' } },
        create: { documentTypeId: documentType.id, productKey: 'auto', required: true, position: index },
        update: { required: true },
      });
    }
  }

  for (const [index, type] of TASK_TYPES.entries()) {
    await db.taskType.upsert({
      where: { key: type.key },
      create: { ...type, defaultPriority: type.defaultPriority as never, position: index + 1 },
      update: { name: type.name, position: index + 1 },
    });
  }

  for (const [index, status] of QUOTE_STATUSES.entries()) {
    await db.quoteStatus.upsert({
      where: { key: status.key },
      create: {
        key: status.key,
        name: status.name,
        isProvided: 'isProvided' in status ? Boolean(status.isProvided) : false,
        isClosed: 'isClosed' in status ? Boolean(status.isClosed) : false,
        color: status.color,
        position: index + 1,
      },
      update: { name: status.name, color: status.color, position: index + 1 },
    });
  }

  for (const [index, group] of AGE_GROUPS.entries()) {
    await db.ageGroup.upsert({
      where: { name: group.name },
      create: { ...group, position: index + 1 },
      update: { minAge: group.minAge, maxAge: group.maxAge, position: index + 1 },
    });
  }

  console.log('  reference data ready');
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMeAfterSetup2026';

const USERS = [
  { email: 'admin@brokerage.test', name: 'Alex Morgan', role: 'ADMINISTRATOR' },
  { email: 'broker@brokerage.test', name: 'Priya Sharma', role: 'BROKER' },
  { email: 'agent@brokerage.test', name: 'Daniel Okafor', role: 'AGENT' },
  { email: 'assistant@brokerage.test', name: 'Mei Chen', role: 'ASSISTANT' },
];

async function seedUsers() {
  console.log('Seeding users…');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const users = [];
  for (const user of USERS) {
    users.push(
      await db.user.upsert({
        where: { email: user.email },
        create: { ...user, role: user.role as never, passwordHash },
        update: { name: user.name, role: user.role as never },
      }),
    );
  }

  console.log(`  ${users.length} users ready (password: ${DEMO_PASSWORD})`);
  return users;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

function daysAgo(days: number, hour = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function dob(age: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setMonth(3, 12);
  return d;
}

async function seedDemoData(users: Array<{ id: string; role: string }>) {
  const existing = await db.client.count();
  if (existing > 0) {
    console.log('Demo data: clients already exist, skipping');
    return;
  }

  console.log('Seeding demo clients…');

  const broker = users.find((u) => u.role === 'BROKER')!;
  const agent = users.find((u) => u.role === 'AGENT')!;

  const stages = Object.fromEntries(
    (await db.pipelineStage.findMany()).map((s) => [s.key, s.id]),
  ) as Record<string, string>;
  const sources = Object.fromEntries(
    (await db.leadSource.findMany()).map((s) => [s.key, s.id]),
  ) as Record<string, string>;
  const companies = Object.fromEntries(
    (await db.insuranceCompany.findMany()).map((c) => [c.code ?? c.name, c.id]),
  ) as Record<string, string>;
  const quoteStatuses = Object.fromEntries(
    (await db.quoteStatus.findMany()).map((s) => [s.key, s.id]),
  ) as Record<string, string>;
  const docTypes = Object.fromEntries(
    (await db.documentType.findMany()).map((t) => [t.key, t.id]),
  ) as Record<string, string>;
  const lostReasons = Object.fromEntries(
    (await db.lostReason.findMany()).map((r) => [r.key, r.id]),
  ) as Record<string, string>;

  const demoClients = [
    {
      firstName: 'Rahul',
      lastName: 'Verma',
      phone: '+14165550101',
      email: 'rahul.verma@example.com',
      age: 27,
      stage: 'quote_provided',
      source: 'facebook',
      assigned: agent.id,
      city: 'Brampton',
      messages: [
        { dir: 'INBOUND', text: 'Hi, I need car insurance for my Civic', ago: 6, intent: 'quote_request', confidence: 0.93 },
        { dir: 'OUTBOUND', text: "Happy to help! Could you send your driver's licence and vehicle ownership?", ago: 6 },
        { dir: 'INBOUND', text: 'Sent both just now', ago: 5, intent: 'sending_documents', confidence: 0.88 },
        { dir: 'OUTBOUND', text: 'Thanks! Aviva came back at $475/month. Let me know what you think.', ago: 3 },
        { dir: 'INBOUND', text: "That's quite expensive, can you find something cheaper?", ago: 2, intent: 'price_objection', confidence: 0.91 },
      ],
      quotes: [
        { company: 'AVIVA', monthly: 475, status: 'provided', selected: false },
        { company: 'PEMB', monthly: 520, status: 'provided', selected: false },
        { company: 'ECH', monthly: 490, status: 'draft', selected: false },
      ],
      vehicle: { year: 2019, make: 'Honda', model: 'Civic', vin: '2HGFC2F59KH123456' },
      needsAttention: true,
      attentionReason: 'Price objection — needs a response',
      labels: ['price_objection'],
    },
    {
      firstName: 'Amina',
      lastName: 'Hassan',
      phone: '+14165550102',
      email: 'amina.hassan@example.com',
      age: 34,
      stage: 'ready_to_bind',
      source: 'referral',
      assigned: broker.id,
      city: 'Mississauga',
      messages: [
        { dir: 'INBOUND', text: 'Looking for insurance on a 2021 RAV4', ago: 12, intent: 'quote_request', confidence: 0.94 },
        { dir: 'OUTBOUND', text: 'Intact quoted $312/month with the multi-vehicle discount.', ago: 4 },
        { dir: 'INBOUND', text: "Let's do it, where do I pay?", ago: 1, intent: 'ready_to_bind', confidence: 0.96 },
      ],
      quotes: [
        { company: 'INTACT', monthly: 312, status: 'accepted', selected: true },
        { company: 'ECON', monthly: 358, status: 'declined', selected: false },
      ],
      vehicle: { year: 2021, make: 'Toyota', model: 'RAV4', vin: '2T3P1RFV5MC123456' },
      needsAttention: true,
      attentionReason: 'Ready to bind',
      labels: ['ready_to_bind'],
    },
    {
      firstName: 'Jordan',
      lastName: 'Price',
      phone: '+14165550103',
      age: 22,
      stage: 'documents_requested',
      source: 'instagram',
      assigned: agent.id,
      city: 'Toronto',
      messages: [
        { dir: 'INBOUND', text: 'need insurance asap', ago: 3, intent: 'quote_request', confidence: 0.82 },
        { dir: 'OUTBOUND', text: "Sure — please send your driver's licence and vehicle ownership to get started.", ago: 3 },
      ],
      quotes: [],
      vehicle: { year: 2016, make: 'Mazda', model: '3', vin: null },
      labels: ['missing_documents'],
    },
    {
      firstName: 'Grace',
      lastName: 'Okonkwo',
      phone: '+14165550104',
      email: 'grace.o@example.com',
      age: 45,
      stage: 'policy_completed',
      source: 'existing_client',
      assigned: broker.id,
      city: 'Scarborough',
      messages: [
        { dir: 'INBOUND', text: 'Renewing my policy this year please', ago: 40, intent: 'renewal_enquiry', confidence: 0.9 },
        { dir: 'OUTBOUND', text: 'All set — documents are on the way.', ago: 30 },
      ],
      quotes: [{ company: 'WAW', monthly: 189, status: 'accepted', selected: true }],
      vehicle: { year: 2018, make: 'Subaru', model: 'Outback', vin: '4S4BSANC4J3123456' },
      policy: { company: 'WAW', monthly: 189, annual: 2268 },
    },
    {
      firstName: 'Tomas',
      lastName: 'Silva',
      phone: '+14165550105',
      age: 52,
      stage: 'lost',
      source: 'google',
      assigned: agent.id,
      city: 'Etobicoke',
      messages: [
        { dir: 'INBOUND', text: 'How much for a 2020 F-150?', ago: 25, intent: 'quote_request', confidence: 0.9 },
        { dir: 'OUTBOUND', text: 'Best I found was $402/month with Gore Mutual.', ago: 22 },
        { dir: 'INBOUND', text: 'I went with another broker, thanks', ago: 20, intent: 'purchased_elsewhere', confidence: 0.92 },
      ],
      quotes: [{ company: 'GORE', monthly: 402, status: 'declined', selected: false }],
      vehicle: { year: 2020, make: 'Ford', model: 'F-150', vin: '1FTEW1EP5LF123456' },
      lostReason: 'bought_elsewhere',
    },
    {
      firstName: 'Leila',
      lastName: 'Nasser',
      phone: '+14165550106',
      age: 19,
      stage: 'new_lead',
      source: 'whatsapp_direct',
      assigned: null,
      city: 'Toronto',
      messages: [{ dir: 'INBOUND', text: 'hi', ago: 0, intent: 'greeting', confidence: 0.7 }],
      quotes: [],
      vehicle: null,
    },
    {
      firstName: 'Marcus',
      lastName: 'Bell',
      phone: '+14165550107',
      email: 'marcus.bell@example.com',
      age: 38,
      stage: 'follow_up_required',
      source: 'website',
      assigned: agent.id,
      city: 'Vaughan',
      messages: [
        { dir: 'INBOUND', text: 'Can I get a quote for two cars?', ago: 9, intent: 'quote_request', confidence: 0.92 },
        { dir: 'OUTBOUND', text: 'Echelon came back at $610/month for both.', ago: 5 },
        { dir: 'INBOUND', text: 'Let me think about it and get back to you next week', ago: 4, intent: 'requesting_follow_up', confidence: 0.86 },
      ],
      quotes: [{ company: 'ECH', monthly: 610, status: 'provided', selected: false }],
      vehicle: { year: 2017, make: 'Nissan', model: 'Rogue', vin: '5N1AT2MT8HC123456' },
      followUp: { reasonKey: 'thinking_about_it', inDays: 2 },
    },
    {
      firstName: 'Sofia',
      lastName: 'Ramirez',
      phone: '+14165550108',
      age: 29,
      stage: 'quoting',
      source: 'referral',
      assigned: broker.id,
      city: 'Markham',
      messages: [
        { dir: 'INBOUND', text: 'My friend recommended you. I need auto and tenant insurance.', ago: 2, intent: 'quote_request', confidence: 0.94 },
      ],
      quotes: [],
      vehicle: { year: 2022, make: 'Hyundai', model: 'Elantra', vin: 'KMHLM4AG5NU123456' },
    },
  ];

  for (const spec of demoClients) {
    const createdAt = daysAgo(Math.max(...spec.messages.map((m) => m.ago), 1) + 1);

    const client = await db.client.create({
      data: {
        firstName: spec.firstName,
        lastName: spec.lastName,
        displayName: `${spec.firstName} ${spec.lastName}`,
        email: spec.email ?? null,
        phone: spec.phone,
        dateOfBirth: dob(spec.age),
        city: spec.city,
        province: 'ON',
        country: 'CA',
        stageId: stages[spec.stage]!,
        stageEnteredAt: daysAgo(Math.min(...spec.messages.map((m) => m.ago))),
        leadSourceId: sources[spec.source] ?? null,
        assignedUserId: spec.assigned ?? null,
        lostReasonId: spec.lostReason ? (lostReasons[spec.lostReason] ?? null) : null,
        products: ['auto'],
        tags: ['demo'],
        createdAt,
        needsAttention: spec.needsAttention ?? false,
        attentionReason: spec.attentionReason ?? null,
        lastActivityAt: daysAgo(Math.min(...spec.messages.map((m) => m.ago))),
      },
    });

    await db.clientStageHistory.create({
      data: { clientId: client.id, toStageId: stages[spec.stage]!, changedBy: 'system', reason: 'Seeded' },
    });

    // Driver
    await db.driver.create({
      data: {
        clientId: client.id,
        fullName: `${spec.firstName} ${spec.lastName}`,
        firstName: spec.firstName,
        lastName: spec.lastName,
        isPrimary: true,
        dateOfBirth: dob(spec.age),
        licenceClass: 'G',
        licenceProvince: 'ON',
        yearsLicensed: Math.max(1, spec.age - 18),
        driverTraining: spec.age < 30,
      },
    });

    // Vehicle
    if (spec.vehicle) {
      await db.vehicle.create({
        data: {
          clientId: client.id,
          year: spec.vehicle.year,
          make: spec.vehicle.make,
          model: spec.vehicle.model,
          vin: spec.vehicle.vin,
          ownership: 'owned',
          usage: 'commute',
          annualKilometres: 15000,
          winterTires: true,
        },
      });
    }

    // Conversation + messages
    const conversation = await db.conversation.create({
      data: {
        clientId: client.id,
        channel: 'WHATSAPP',
        externalId: spec.phone,
        inboxId: 'default',
        labels: spec.labels ?? [],
        state: spec.messages[spec.messages.length - 1]?.dir === 'INBOUND' ? 'WAITING_ON_US' : 'WAITING_ON_CLIENT',
        unreadCount: spec.messages.filter((m) => m.dir === 'INBOUND').slice(-1).length,
        priority: spec.stage === 'ready_to_bind' ? 'URGENT' : spec.needsAttention ? 'HIGH' : 'NORMAL',
        lastMessageAt: daysAgo(Math.min(...spec.messages.map((m) => m.ago))),
      },
    });

    for (const [i, m] of spec.messages.entries()) {
      const message = await db.message.create({
        data: {
          conversationId: conversation.id,
          clientId: client.id,
          externalId: `seed-${client.id}-${i}`,
          channel: 'WHATSAPP',
          direction: m.dir as never,
          contentType: 'TEXT',
          body: m.text,
          rawPayload: { seeded: true },
          deliveryStatus: m.dir === 'INBOUND' ? 'DELIVERED' : 'READ',
          sentAt: daysAgo(m.ago, 9 + i),
          isRead: m.dir === 'OUTBOUND' || i < spec.messages.length - 1,
          sentByUserId: m.dir === 'OUTBOUND' ? (spec.assigned ?? broker.id) : null,
        },
      });

      if ('intent' in m && m.intent) {
        await db.messageAnalysis.create({
          data: {
            messageId: message.id,
            intent: m.intent,
            confidence: m.confidence ?? 0.8,
            sentiment: m.intent === 'price_objection' || m.intent === 'purchased_elsewhere' ? 'negative' : 'neutral',
            urgency: m.intent === 'ready_to_bind' ? 'HIGH' : 'NORMAL',
            entities: {},
            secondaryIntents: [],
            summary: m.text.slice(0, 80),
            provider: 'mock',
            model: 'rules-v1',
          },
        });
      }

      await db.activityEvent.create({
        data: {
          clientId: client.id,
          type: m.dir === 'INBOUND' ? 'message.received' : 'message.sent',
          title: m.dir === 'INBOUND' ? 'Received a WhatsApp message' : 'WhatsApp message sent',
          body: m.text.slice(0, 200),
          actorType: m.dir === 'INBOUND' ? 'client' : 'user',
          actorId: m.dir === 'OUTBOUND' ? (spec.assigned ?? broker.id) : null,
          createdAt: daysAgo(m.ago, 9 + i),
        },
      });
    }

    await db.client.update({
      data: {
        unreadCount: conversation.unreadCount,
        lastInboundAt: daysAgo(Math.min(...spec.messages.filter((m) => m.dir === 'INBOUND').map((m) => m.ago))),
        lastOutboundAt: spec.messages.some((m) => m.dir === 'OUTBOUND')
          ? daysAgo(Math.min(...spec.messages.filter((m) => m.dir === 'OUTBOUND').map((m) => m.ago)))
          : null,
      },
      where: { id: client.id },
    });

    // Quotes
    for (const q of spec.quotes ?? []) {
      const quote = await db.quote.create({
        data: {
          clientId: client.id,
          insuranceCompanyId: companies[q.company]!,
          statusId: quoteStatuses[q.status]!,
          quoteDate: daysAgo(3),
          monthlyPremium: q.monthly,
          annualPremium: Number((q.monthly * 12).toFixed(2)),
          coverageType: 'full',
          liabilityLimit: 2000000,
          collisionDeductible: 1000,
          comprehensiveDeductible: 500,
          telematics: q.monthly < 400,
          discounts: [{ name: 'Winter tires', amount: 45 }],
          isSelected: q.selected,
          selectedAt: q.selected ? daysAgo(1) : null,
          sentToClientAt: q.status !== 'draft' ? daysAgo(3) : null,
          createdByUserId: spec.assigned ?? broker.id,
        },
      });

      await db.activityEvent.create({
        data: {
          clientId: client.id,
          type: 'quote.created',
          title: `Quote created — ${q.company}`,
          body: `$${q.monthly}/month`,
          actorType: 'user',
          actorId: spec.assigned ?? broker.id,
          entityType: 'Quote',
          entityId: quote.id,
          createdAt: daysAgo(3),
        },
      });
    }

    // Policy
    if (spec.policy) {
      await db.policy.create({
        data: {
          clientId: client.id,
          insuranceCompanyId: companies[spec.policy.company]!,
          policyNumber: `POL-${client.reference.toString().padStart(6, '0')}`,
          status: 'ACTIVE',
          effectiveDate: daysAgo(28),
          expiryDate: daysAgo(-337),
          renewalDate: daysAgo(-337),
          monthlyPremium: spec.policy.monthly,
          annualPremium: spec.policy.annual,
          commissionRate: 0.12,
          commissionAmount: Number((spec.policy.annual * 0.12).toFixed(2)),
          paymentMethod: 'monthly_pad',
          boundAt: daysAgo(28),
          boundByUserId: broker.id,
        },
      });
    }

    // Document checklist
    for (const key of ['drivers_licence', 'vehicle_ownership', 'void_cheque']) {
      const satisfied =
        spec.stage === 'policy_completed' ||
        spec.stage === 'ready_to_bind' ||
        (spec.stage === 'quote_provided' && key !== 'void_cheque');

      await db.documentChecklistItem.create({
        data: {
          clientId: client.id,
          documentTypeId: docTypes[key]!,
          required: true,
          status: satisfied ? 'RECEIVED' : spec.stage === 'documents_requested' ? 'REQUESTED' : 'NOT_REQUESTED',
          requestedAt: spec.stage === 'documents_requested' ? daysAgo(3) : null,
          lastRequestedAt: spec.stage === 'documents_requested' ? daysAgo(3) : null,
          requestCount: spec.stage === 'documents_requested' ? 1 : 0,
          receivedAt: satisfied ? daysAgo(4) : null,
        },
      });
    }

    // Follow-up
    if (spec.followUp) {
      await db.followUp.create({
        data: {
          clientId: client.id,
          reasonKey: spec.followUp.reasonKey,
          reason: 'Customer asked for time to think',
          dueAt: daysAgo(-spec.followUp.inDays, 10),
          priority: 'NORMAL',
          assignedUserId: spec.assigned,
          createdBySystem: 'workflow:requesting_follow_up',
          dedupeKey: `seed-followup-${client.id}`,
        },
      });
    }

    // A couple of open tasks so the task board is not empty.
    if (spec.stage === 'quote_provided') {
      await db.task.create({
        data: {
          clientId: client.id,
          title: `Check alternative companies for ${spec.firstName}`,
          description: 'Customer felt the current quote was too expensive.',
          priority: 'HIGH',
          status: 'OPEN',
          dueAt: daysAgo(-0, 16),
          assignedUserId: spec.assigned,
          createdBySystem: 'workflow:price_objection',
          dedupeKey: `seed-task-alt-${client.id}`,
        },
      });
    }

    if (spec.stage === 'ready_to_bind') {
      await db.task.create({
        data: {
          clientId: client.id,
          title: `Bind policy for ${spec.firstName}`,
          priority: 'URGENT',
          status: 'OPEN',
          dueAt: daysAgo(-0, 14),
          assignedUserId: broker.id,
          createdBySystem: 'workflow:ready_to_bind',
          dedupeKey: `seed-task-bind-${client.id}`,
        },
      });
    }

    if (spec.stage === 'documents_requested') {
      await db.task.create({
        data: {
          clientId: client.id,
          title: `Chase documents from ${spec.firstName}`,
          priority: 'NORMAL',
          status: 'OPEN',
          dueAt: daysAgo(1, 12),
          assignedUserId: spec.assigned,
          createdBySystem: 'workflow:document_request',
          dedupeKey: `seed-task-docs-${client.id}`,
        },
      });
    }

    // An AI suggestion awaiting review, so that screen has content.
    if (spec.stage === 'quote_provided') {
      await db.aiSuggestion.create({
        data: {
          clientId: client.id,
          kind: 'STAGE_CHANGE',
          status: 'PENDING',
          confidence: 0.78,
          payload: { toStageKey: 'follow_up_required', fromStageKey: spec.stage },
          rationale: 'Customer raised a price objection. Confidence 78% was below the threshold.',
        },
      });
    }
  }

  // Notifications for the admin so the bell is not empty.
  const admin = users.find((u) => u.role === 'ADMINISTRATOR')!;
  const readyClient = await db.client.findFirst({ where: { stage: { key: 'ready_to_bind' } } });
  if (readyClient) {
    await db.notification.create({
      data: {
        userId: admin.id,
        clientId: readyClient.id,
        type: 'client.ready_to_bind',
        severity: 'CRITICAL',
        title: `${readyClient.displayName} is ready to bind`,
        body: 'Customer confirmed they want to proceed.',
        linkUrl: `/clients/${readyClient.id}`,
      },
    });
  }

  console.log(`  ${demoClients.length} demo clients created`);
}

// ---------------------------------------------------------------------------

async function main() {
  await seedReferenceData();
  const users = await seedUsers();
  if (SEED_DEMO) await seedDemoData(users);
  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
