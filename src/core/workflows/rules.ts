import { INTENTS } from '@/integrations/ai/vocabulary';
import type { WorkflowAction, WorkflowContext, WorkflowRule } from './types';

/**
 * The business rules.
 *
 * This file is the answer to "what does the CRM actually *do* when a customer
 * says something?" It is deliberately the most readable file in the codebase —
 * a broker should be able to read it and recognise their own process, and a
 * developer should be able to change the behaviour by editing one rule without
 * understanding the AI layer or the messaging layer at all.
 *
 * Rules never write to the database. See engine.ts.
 *
 * Note what is NOT here: nothing binds a policy, prices a risk, decides
 * eligibility, or commits to coverage. Those stay with licensed humans.
 */

const HOUR = 1;

export const WORKFLOW_RULES: WorkflowRule[] = [
  // -------------------------------------------------------------------------
  // Intent: the customer wants a quote
  // -------------------------------------------------------------------------
  {
    key: 'quote_request',
    description: 'Customer is asking for insurance — start quoting and collect documents.',
    priority: 100,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.QUOTE_REQUEST,
    actions: (ctx) => {
      const actions: WorkflowAction[] = [
        { type: 'move_stage', toStageKey: 'quote_requested', reason: 'Customer asked for a quote' },
        { type: 'label_conversation', label: 'quote_request', present: true },
      ];

      if (ctx.settings.autoRequestDocuments && ctx.outstandingDocuments.length) {
        actions.push({ type: 'request_documents' });
      }

      actions.push({
        type: 'create_task',
        title: `Prepare quote for ${ctx.client.displayName}`,
        taskTypeKey: 'prepare_quote',
        priority: 'HIGH',
        dueInHours: 24,
        dedupeSuffix: 'prepare-quote',
      });

      actions.push({
        type: 'notify',
        event: 'lead.quote_requested',
        title: `${ctx.client.displayName} asked for a quote`,
      });

      return actions;
    },
  },

  // -------------------------------------------------------------------------
  // Intent: price objection
  // -------------------------------------------------------------------------
  {
    key: 'price_objection',
    description: 'Customer said the price is too high — find an alternative quickly.',
    priority: 95,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.PRICE_OBJECTION,
    actions: (ctx) => [
      { type: 'move_stage', toStageKey: 'follow_up_required', reason: 'Customer raised a price objection' },
      { type: 'label_conversation', label: 'price_objection', present: true },
      { type: 'set_priority', priority: 'HIGH' },
      {
        type: 'create_follow_up',
        reasonKey: 'price_objection',
        reason: 'Customer said the price was too high',
        dueInHours: ctx.settings.priceObjectionFollowUpHours,
        priority: 'HIGH',
        dedupeSuffix: 'price-objection',
      },
      {
        type: 'create_task',
        title: `Check alternative companies for ${ctx.client.displayName}`,
        description: 'Customer felt the current quote was too expensive.',
        taskTypeKey: 'check_alternative_company',
        priority: 'HIGH',
        dueInHours: ctx.settings.priceObjectionFollowUpHours,
        dedupeSuffix: 'alt-company',
      },
      { type: 'flag_attention', reason: 'Price objection — needs a response' },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: wants a different company / another quote
  // -------------------------------------------------------------------------
  {
    key: 'alternative_quote',
    description: 'Customer asked to try another insurer.',
    priority: 90,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.REQUESTING_ALTERNATIVE_QUOTE,
    actions: (ctx) => {
      const company = ctx.analysis?.entities?.requestedCompany;
      return [
        { type: 'move_stage', toStageKey: 'quoting', reason: 'Customer asked for another option' },
        {
          type: 'create_task',
          title: company
            ? `Quote ${ctx.client.displayName} with ${String(company)}`
            : `Find an alternative quote for ${ctx.client.displayName}`,
          taskTypeKey: 'check_alternative_company',
          priority: 'HIGH',
          dueInHours: 12,
          dedupeSuffix: 'alt-quote',
        },
        { type: 'flag_attention', reason: 'Waiting on an alternative quote' },
      ];
    },
  },

  // -------------------------------------------------------------------------
  // Intent: ready to bind — high value, never automated
  // -------------------------------------------------------------------------
  {
    key: 'ready_to_bind',
    description: 'Customer explicitly agreed to proceed. Escalate to a licensed broker.',
    priority: 120,
    // The stage move is consequential enough that it always waits for a human.
    autoApplyAllowed: false,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.READY_TO_BIND,
    actions: (ctx) => [
      { type: 'move_stage', toStageKey: 'ready_to_bind', reason: 'Customer agreed to proceed' },
      { type: 'label_conversation', label: 'ready_to_bind', present: true },
      { type: 'set_priority', priority: 'URGENT' },
      {
        type: 'create_task',
        title: `Bind policy for ${ctx.client.displayName}`,
        description: 'Customer confirmed they want to proceed. Confirm details and bind.',
        taskTypeKey: 'bind_policy',
        priority: 'URGENT',
        dueInHours: 4,
        dedupeSuffix: 'bind',
      },
      {
        type: 'notify',
        event: 'client.ready_to_bind',
        title: `${ctx.client.displayName} is ready to bind`,
        body: 'Customer confirmed they want to proceed.',
        severity: 'CRITICAL',
      },
      { type: 'flag_attention', reason: 'Ready to bind' },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: wants to proceed (softer than ready to bind)
  // -------------------------------------------------------------------------
  {
    key: 'wants_to_proceed',
    description: 'Positive signal short of an explicit commitment.',
    priority: 80,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.WANTS_TO_PROCEED,
    actions: (ctx) => {
      const actions: WorkflowAction[] = [
        { type: 'move_stage', toStageKey: 'interested', reason: 'Customer signalled interest' },
      ];
      if (ctx.outstandingDocuments.length) {
        actions.push({
          type: 'create_task',
          title: `Collect outstanding documents from ${ctx.client.displayName}`,
          description: `Still needed: ${ctx.outstandingDocuments.map((d) => d.name).join(', ')}`,
          taskTypeKey: 'request_documents',
          priority: 'HIGH',
          dueInHours: 24,
          dedupeSuffix: 'collect-docs',
        });
      }
      return actions;
    },
  },

  // -------------------------------------------------------------------------
  // Intent: sending documents
  // -------------------------------------------------------------------------
  {
    key: 'sending_documents',
    description: 'Customer is sending paperwork — acknowledge and track it.',
    priority: 85,
    matches: (ctx) =>
      ctx.analysis?.intent === INTENTS.SENDING_DOCUMENTS ||
      Boolean(ctx.message?.hasAttachments && ctx.client.stageCategory === 'OPEN'),
    actions: (ctx) => {
      const actions: WorkflowAction[] = [
        { type: 'label_conversation', label: 'documents_received', present: true },
      ];

      // Only advance the stage once the checklist is actually satisfied; the
      // document pipeline re-evaluates after extraction.
      if (ctx.outstandingDocuments.length === 0) {
        actions.push({
          type: 'move_stage',
          toStageKey: 'documents_received',
          reason: 'All required documents received',
        });
        actions.push({ type: 'label_conversation', label: 'missing_documents', present: false });
      } else {
        actions.push({ type: 'label_conversation', label: 'missing_documents', present: true });
      }

      return actions;
    },
  },

  // -------------------------------------------------------------------------
  // Intent: asked to be contacted later / needs time
  // -------------------------------------------------------------------------
  {
    key: 'requesting_follow_up',
    description: 'Customer asked for time or a callback.',
    priority: 75,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.REQUESTING_FOLLOW_UP,
    actions: (ctx) => [
      { type: 'move_stage', toStageKey: 'follow_up_required', reason: 'Customer asked to be contacted later' },
      {
        type: 'create_follow_up',
        reasonKey: 'call_later',
        reason: 'Customer asked to be contacted later',
        dueInHours: ctx.settings.thinkingAboutItDays * 24,
        dedupeSuffix: 'callback',
      },
      { type: 'clear_attention' },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: not interested / bought elsewhere — never automated
  // -------------------------------------------------------------------------
  {
    key: 'not_interested',
    description: 'Customer declined. Marking a client lost always needs a human.',
    priority: 110,
    autoApplyAllowed: false,
    matches: (ctx) =>
      ctx.analysis?.intent === INTENTS.NOT_INTERESTED ||
      ctx.analysis?.intent === INTENTS.PURCHASED_ELSEWHERE,
    actions: (ctx) => [
      {
        type: 'move_stage',
        toStageKey: 'lost',
        reason:
          ctx.analysis?.intent === INTENTS.PURCHASED_ELSEWHERE
            ? 'Customer bought elsewhere'
            : 'Customer is not interested',
      },
      { type: 'set_priority', priority: 'LOW' },
      { type: 'clear_attention' },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: wants to change information
  // -------------------------------------------------------------------------
  {
    key: 'change_information',
    description: 'Customer wants to correct something already on file.',
    priority: 70,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.CHANGE_INFORMATION,
    actions: (ctx) => [
      {
        type: 'create_task',
        title: `Update details for ${ctx.client.displayName}`,
        description: ctx.message?.body ?? undefined,
        taskTypeKey: 'update_client_information',
        priority: 'HIGH',
        dueInHours: 8,
        dedupeSuffix: 'update-info',
      },
      { type: 'flag_attention', reason: 'Customer wants to change their information' },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: complaint or needs assistance
  // -------------------------------------------------------------------------
  {
    key: 'needs_human',
    description: 'Complaint, confusion, or a direct request for help — get a person on it.',
    priority: 105,
    matches: (ctx) =>
      ctx.analysis?.intent === INTENTS.COMPLAINT || ctx.analysis?.intent === INTENTS.NEEDS_ASSISTANCE,
    actions: (ctx) => [
      { type: 'set_priority', priority: ctx.analysis?.intent === INTENTS.COMPLAINT ? 'URGENT' : 'HIGH' },
      { type: 'flag_attention', reason: 'Customer needs help' },
      {
        type: 'create_task',
        title: `Call ${ctx.client.displayName}`,
        description: ctx.message?.body ?? undefined,
        taskTypeKey: 'call_client',
        priority: 'URGENT',
        dueInHours: 2 * HOUR,
        dedupeSuffix: 'needs-help',
      },
      {
        type: 'notify',
        event: 'client.needs_help',
        title: `${ctx.client.displayName} needs assistance`,
        severity: 'WARNING',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: a question — no stage change, just make sure someone answers
  // -------------------------------------------------------------------------
  {
    key: 'asking_question',
    description: 'Customer asked something. Keep it visible until answered.',
    priority: 40,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.ASKING_QUESTION,
    actions: () => [{ type: 'flag_attention', reason: 'Customer asked a question' }],
  },

  // -------------------------------------------------------------------------
  // Intent: renewal
  // -------------------------------------------------------------------------
  {
    key: 'renewal_enquiry',
    description: 'Customer asked about renewing.',
    priority: 60,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.RENEWAL_ENQUIRY,
    actions: (ctx) => [
      {
        type: 'create_task',
        title: `Review renewal for ${ctx.client.displayName}`,
        taskTypeKey: 'follow_up',
        priority: 'HIGH',
        dueInHours: 24,
        dedupeSuffix: 'renewal',
      },
      { type: 'flag_attention', reason: 'Renewal enquiry' },
    ],
  },

  // -------------------------------------------------------------------------
  // Intent: payment question
  // -------------------------------------------------------------------------
  {
    key: 'payment_question',
    description: 'Billing or payment question — route to a person, never auto-answer.',
    priority: 65,
    autoApplyAllowed: false,
    matches: (ctx) => ctx.analysis?.intent === INTENTS.PAYMENT_QUESTION,
    actions: (ctx) => [
      {
        type: 'create_task',
        title: `Answer payment question — ${ctx.client.displayName}`,
        description: ctx.message?.body ?? undefined,
        taskTypeKey: 'call_client',
        priority: 'HIGH',
        dueInHours: 8,
        dedupeSuffix: 'payment-question',
      },
      { type: 'flag_attention', reason: 'Payment question' },
    ],
  },

  // -------------------------------------------------------------------------
  // Cross-cutting: AI could not understand the message
  // -------------------------------------------------------------------------
  {
    key: 'ai_uncertain',
    description: 'AI was not confident. Put it in front of a person rather than guessing.',
    priority: 200,
    autoApplyAllowed: false,
    matches: (ctx) =>
      Boolean(ctx.analysis) &&
      (ctx.analysis!.intent === INTENTS.UNKNOWN ||
        ctx.analysis!.confidence < ctx.settings.stageChangeMinConfidence * 0.7),
    actions: (ctx) => [
      { type: 'label_conversation', label: 'ai_uncertain', present: true },
      { type: 'flag_attention', reason: 'AI could not confidently understand this message' },
      {
        type: 'notify',
        event: 'ai.uncertain',
        title: `Unclear message from ${ctx.client.displayName}`,
        body: ctx.message?.body?.slice(0, 140),
        severity: 'WARNING',
      },
    ],
  },
];

/** Rules that match, highest priority first. */
export function matchingRules(ctx: WorkflowContext): WorkflowRule[] {
  return WORKFLOW_RULES.filter((rule) => {
    try {
      return rule.matches(ctx);
    } catch {
      return false;
    }
  }).sort((a, b) => b.priority - a.priority);
}
