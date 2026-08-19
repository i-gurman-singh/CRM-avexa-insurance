/**
 * Default values for every configurable behaviour in the CRM.
 *
 * Nothing here is hard-coded into business logic: services read settings
 * through `getSetting()`, which falls back to these defaults when an
 * administrator hasn't overridden them in Settings → Automation.
 *
 * Adding a new configurable knob: add it here with a sensible default and a
 * description, and it appears in the admin UI automatically.
 */

export interface SettingSpec<T = unknown> {
  key: string;
  category: 'automation' | 'followups' | 'ai' | 'pipeline' | 'notifications' | 'general';
  label: string;
  description: string;
  type: 'boolean' | 'number' | 'string' | 'json';
  default: T;
}

export const SETTING_SPECS = {
  // --- Automation -----------------------------------------------------------
  'automation.autoCreateLeads': {
    key: 'automation.autoCreateLeads',
    category: 'automation',
    label: 'Create a lead for unknown numbers',
    description: 'When a phone number we do not recognise messages us, create a new lead automatically.',
    type: 'boolean',
    default: true,
  },
  'automation.autoRequestDocuments': {
    key: 'automation.autoRequestDocuments',
    category: 'automation',
    label: 'Automatically request missing documents',
    description:
      'When a quote request is detected, ask the client for the documents on their checklist. Requires outbound automation to be enabled.',
    type: 'boolean',
    default: true,
  },
  'automation.maxDocumentRequestsPerItem': {
    key: 'automation.maxDocumentRequestsPerItem',
    category: 'automation',
    label: 'Maximum automatic requests per document',
    description: 'Stop asking for the same document after this many automated attempts, and create a task instead.',
    type: 'number',
    default: 2,
  },
  'automation.documentRequestCooldownHours': {
    key: 'automation.documentRequestCooldownHours',
    category: 'automation',
    label: 'Hours between document reminders',
    description: 'Minimum time before the CRM will ask again for the same outstanding document.',
    type: 'number',
    default: 24,
  },
  'automation.autoMarkReadOnReply': {
    key: 'automation.autoMarkReadOnReply',
    category: 'automation',
    label: 'Mark conversation read when staff reply',
    description: 'Clear the unread badge automatically once someone replies from the CRM.',
    type: 'boolean',
    default: true,
  },

  // --- AI -------------------------------------------------------------------
  'ai.enabled': {
    key: 'ai.enabled',
    category: 'ai',
    label: 'Enable AI message understanding',
    description: 'Run inbound messages through the AI classifier. Messages are always stored regardless.',
    type: 'boolean',
    default: true,
  },
  'ai.documentAnalysisEnabled': {
    key: 'ai.documentAnalysisEnabled',
    category: 'ai',
    label: 'Enable AI document reading',
    description: 'Extract fields from incoming images and PDFs for staff to verify.',
    type: 'boolean',
    default: true,
  },
  'ai.autoApplyStageChanges': {
    key: 'ai.autoApplyStageChanges',
    category: 'ai',
    label: 'Auto-apply confident stage changes',
    description:
      'Move a client to a suggested stage without asking, when confidence is above the threshold and the move is reversible. Never applies to Ready to Bind or Lost.',
    type: 'boolean',
    default: true,
  },
  'ai.stageChangeMinConfidence': {
    key: 'ai.stageChangeMinConfidence',
    category: 'ai',
    label: 'Minimum confidence to auto-apply a stage change',
    description: 'Below this, the CRM records a suggestion for staff to accept or reject.',
    type: 'number',
    default: 0.85,
  },
  'ai.fieldUpdateMinConfidence': {
    key: 'ai.fieldUpdateMinConfidence',
    category: 'ai',
    label: 'Minimum confidence to auto-fill an empty field',
    description:
      'Extracted values above this confidence fill blank fields automatically. Existing values are never overwritten without a human.',
    type: 'number',
    default: 0.9,
  },
  'ai.uncertaintyThreshold': {
    key: 'ai.uncertaintyThreshold',
    category: 'ai',
    label: 'Flag conversation as uncertain below',
    description: 'Conversations where AI confidence falls below this appear in the "AI uncertain" filter.',
    type: 'number',
    default: 0.6,
  },
  'ai.suggestRepliesEnabled': {
    key: 'ai.suggestRepliesEnabled',
    category: 'ai',
    label: 'Draft suggested replies',
    description: 'Show a suggested reply staff can edit and send. Drafts are never sent automatically.',
    type: 'boolean',
    default: true,
  },

  // --- Follow-ups -----------------------------------------------------------
  'followups.noResponseAfterHours': {
    key: 'followups.noResponseAfterHours',
    category: 'followups',
    label: 'Flag no response after (hours)',
    description: 'Create a follow-up when a client has not replied to us for this long.',
    type: 'number',
    default: 48,
  },
  'followups.quoteProvidedFollowUpHours': {
    key: 'followups.quoteProvidedFollowUpHours',
    category: 'followups',
    label: 'Follow up after sending a quote (hours)',
    description: 'Schedule a follow-up this long after a quote is sent, if the client has not replied.',
    type: 'number',
    default: 24,
  },
  'followups.priceObjectionFollowUpHours': {
    key: 'followups.priceObjectionFollowUpHours',
    category: 'followups',
    label: 'Follow up after a price objection (hours)',
    description: 'How long to give staff to find an alternative before the follow-up is due.',
    type: 'number',
    default: 4,
  },
  'followups.thinkingAboutItDays': {
    key: 'followups.thinkingAboutItDays',
    category: 'followups',
    label: 'Follow up when a client asks for time (days)',
    description: 'Default follow-up delay when a client says they need to think about it.',
    type: 'number',
    default: 3,
  },
  'followups.renewalNoticeDays': {
    key: 'followups.renewalNoticeDays',
    category: 'followups',
    label: 'Renewal reminder lead time (days)',
    description: 'Create a renewal follow-up this many days before a policy expires.',
    type: 'number',
    default: 45,
  },

  // --- Pipeline -------------------------------------------------------------
  'pipeline.staleLeadHours': {
    key: 'pipeline.staleLeadHours',
    category: 'pipeline',
    label: 'Flag a lead as needing attention after (hours)',
    description: 'Used by the dashboard "Leads requiring attention" card when a stage has no specific SLA.',
    type: 'number',
    default: 72,
  },
  'pipeline.autoAdvanceOnDocuments': {
    key: 'pipeline.autoAdvanceOnDocuments',
    category: 'pipeline',
    label: 'Advance stage when all documents are received',
    description: 'Move a client from Documents Requested to Documents Received once the checklist is complete.',
    type: 'boolean',
    default: true,
  },

  // --- Notifications --------------------------------------------------------
  'notifications.notifyOnNewLead': {
    key: 'notifications.notifyOnNewLead',
    category: 'notifications',
    label: 'Notify on new lead',
    description: 'Notify the assigned user, or all active users when unassigned.',
    type: 'boolean',
    default: true,
  },
  'notifications.notifyOnReply': {
    key: 'notifications.notifyOnReply',
    category: 'notifications',
    label: 'Notify when a client replies',
    description: 'Only the assigned user is notified, to keep the volume manageable.',
    type: 'boolean',
    default: true,
  },
  'notifications.notifyOnReadyToBind': {
    key: 'notifications.notifyOnReadyToBind',
    category: 'notifications',
    label: 'Notify when a client is ready to bind',
    description: 'High-priority notification to the assigned user and all brokers.',
    type: 'boolean',
    default: true,
  },
  'notifications.notifyOnAiUncertain': {
    key: 'notifications.notifyOnAiUncertain',
    category: 'notifications',
    label: 'Notify when AI is unsure',
    description: 'Alert staff when a message or document could not be understood confidently.',
    type: 'boolean',
    default: true,
  },
  'notifications.digestGroupingMinutes': {
    key: 'notifications.digestGroupingMinutes',
    category: 'notifications',
    label: 'Group repeated notifications within (minutes)',
    description: 'Repeated events for the same client collapse into one notification inside this window.',
    type: 'number',
    default: 30,
  },

  // --- General --------------------------------------------------------------
  'general.brokerageName': {
    key: 'general.brokerageName',
    category: 'general',
    label: 'Brokerage name',
    description: 'Shown in the CRM header and used in message templates.',
    type: 'string',
    default: 'Your Brokerage',
  },
  'general.businessHours': {
    key: 'general.businessHours',
    category: 'general',
    label: 'Business hours',
    description: 'Used when scheduling follow-ups so they land during working hours.',
    type: 'json',
    default: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'America/Toronto' },
  },
  'general.defaultProduct': {
    key: 'general.defaultProduct',
    category: 'general',
    label: 'Default product for new leads',
    description: 'Which product a new lead is assumed to be asking about.',
    type: 'string',
    default: 'auto',
  },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTING_SPECS;

export type SettingValue<K extends SettingKey> = (typeof SETTING_SPECS)[K]['default'];

export const SETTING_LIST = Object.values(SETTING_SPECS) as SettingSpec[];
