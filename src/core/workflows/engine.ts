import '@/lib/server-guard';
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import { SYSTEM_ACTOR } from '@/core/context';
import { setNeedsAttention } from '@/core/clients/service';
import { createSuggestion } from '@/core/ai/suggestions';
import { ensureChecklist, outstandingItems } from '@/core/documents/checklist';
import { createSystemFollowUp } from '@/core/followups/service';
import { setConversationLabel } from '@/core/messaging/service';
import { notifyAboutClient } from '@/core/notifications/service';
import { moveClientToStage } from '@/core/pipeline/service';
import { getSettings } from '@/core/settings/service';
import { createSystemTask } from '@/core/tasks/service';
import { requestDocuments } from './documentRequests';
import { matchingRules } from './rules';
import type { WorkflowAction, WorkflowContext } from './types';

const logger = log('workflows:engine');

/**
 * The workflow engine.
 *
 * Takes the context assembled from a message and its AI analysis, asks the
 * rules what should happen, then decides — using business policy, not model
 * confidence alone — whether each proposed action is applied directly or
 * queued as a suggestion for a human.
 *
 * The decision table:
 *
 *   action              | applied automatically when...
 *   --------------------|--------------------------------------------------
 *   label / priority    | always (cosmetic, reversible, no client impact)
 *   flag attention      | always
 *   create task         | always (a task is a prompt for a human, not an act)
 *   create follow-up    | always
 *   request documents   | rule allows it AND the setting is on AND outbound
 *                       | automation is enabled
 *   move stage          | rule allows it AND confidence >= threshold AND the
 *                       | target stage is not terminal (ready_to_bind / lost)
 *   suggest reply       | never sent; always offered to a human
 */

const TERMINAL_STAGE_KEYS = new Set(['ready_to_bind', 'lost', 'policy_completed', 'binding_processing']);

export interface EvaluationResult {
  ruleKeys: string[];
  applied: string[];
  suggested: string[];
}

export async function evaluateWorkflows(ctx: WorkflowContext): Promise<EvaluationResult> {
  const rules = matchingRules(ctx);
  const result: EvaluationResult = { ruleKeys: rules.map((r) => r.key), applied: [], suggested: [] };

  // Deduplicate identical actions proposed by several rules; the highest
  // priority rule wins, since rules are already sorted.
  const seen = new Set<string>();

  for (const rule of rules) {
    let actions: WorkflowAction[];
    try {
      actions = rule.actions(ctx);
    } catch (e) {
      logger.error({ err: e, rule: rule.key }, 'Rule threw while producing actions');
      continue;
    }

    for (const action of actions) {
      const signature = actionSignature(action);
      if (seen.has(signature)) continue;
      seen.add(signature);

      try {
        const outcome = await applyAction(ctx, action, rule.key, rule.autoApplyAllowed !== false);
        if (outcome === 'applied') result.applied.push(`${rule.key}:${action.type}`);
        else if (outcome === 'suggested') result.suggested.push(`${rule.key}:${action.type}`);
      } catch (e) {
        // One failing action must not abort the rest of the evaluation.
        logger.error({ err: e, rule: rule.key, action: action.type }, 'Workflow action failed');
      }
    }
  }

  logger.info(
    { clientId: ctx.client.id, rules: result.ruleKeys, applied: result.applied.length, suggested: result.suggested.length },
    'Workflows evaluated',
  );

  return result;
}

type Outcome = 'applied' | 'suggested' | 'skipped';

async function applyAction(
  ctx: WorkflowContext,
  action: WorkflowAction,
  ruleKey: string,
  autoApplyAllowed: boolean,
): Promise<Outcome> {
  const confidence = ctx.analysis?.confidence ?? 0;

  switch (action.type) {
    // --- Always safe to apply -----------------------------------------------
    case 'label_conversation': {
      if (!ctx.conversation) return 'skipped';
      await setConversationLabel(ctx.conversation.id, action.label, action.present);
      return 'applied';
    }

    case 'set_priority': {
      if (!ctx.conversation) return 'skipped';
      await db.conversation.update({
        where: { id: ctx.conversation.id },
        data: { priority: action.priority },
      });
      return 'applied';
    }

    case 'flag_attention':
      await setNeedsAttention(ctx.client.id, true, action.reason);
      return 'applied';

    case 'clear_attention':
      await setNeedsAttention(ctx.client.id, false);
      return 'applied';

    case 'notify':
      await notifyAboutClient({
        clientId: ctx.client.id,
        type: action.event,
        title: action.title,
        body: action.body,
        severity: action.severity ?? 'INFO',
        assignedUserId: ctx.client.assignedUserId,
      });
      return 'applied';

    // A task is an instruction to a human, not an action taken on their behalf,
    // so creating one is always safe.
    case 'create_task': {
      const created = await createSystemTask({
        clientId: ctx.client.id,
        title: action.title,
        description: action.description,
        taskTypeKey: action.taskTypeKey,
        priority: action.priority,
        dueAt: action.dueInHours ? new Date(Date.now() + action.dueInHours * 3600_000) : undefined,
        assignedUserId: ctx.client.assignedUserId,
        dedupeKey: `${ruleKey}:${ctx.client.id}:${action.dedupeSuffix}`,
        createdBySystem: `workflow:${ruleKey}`,
      });
      return created ? 'applied' : 'skipped';
    }

    case 'create_follow_up': {
      const created = await createSystemFollowUp({
        clientId: ctx.client.id,
        reasonKey: action.reasonKey,
        reason: action.reason,
        dueAt: new Date(Date.now() + action.dueInHours * 3600_000),
        priority: action.priority,
        assignedUserId: ctx.client.assignedUserId,
        dedupeKey: `${ruleKey}:${ctx.client.id}:${action.dedupeSuffix}`,
        createdBySystem: `workflow:${ruleKey}`,
      });
      return created ? 'applied' : 'skipped';
    }

    // --- Conditional --------------------------------------------------------
    case 'request_documents': {
      if (!ctx.settings.autoRequestDocuments || !autoApplyAllowed) {
        await createSuggestion({
          clientId: ctx.client.id,
          kind: 'REQUEST_DOCUMENT',
          confidence,
          payload: {
            documentTypeIds: action.documentTypeIds ?? ctx.outstandingDocuments.map((d) => d.documentTypeId),
          },
          rationale: `Outstanding: ${ctx.outstandingDocuments.map((d) => d.name).join(', ')}`,
          messageId: ctx.message?.id,
          expiresInHours: 72,
        });
        return 'suggested';
      }

      await requestDocuments(SYSTEM_ACTOR, ctx.client.id, action.documentTypeIds);
      return 'applied';
    }

    case 'move_stage': {
      // Already there — nothing to do, and no point suggesting it.
      if (ctx.client.stageKey === action.toStageKey) return 'skipped';

      const isTerminal = TERMINAL_STAGE_KEYS.has(action.toStageKey);
      const confident = confidence >= ctx.settings.stageChangeMinConfidence;
      const canAuto =
        autoApplyAllowed && ctx.settings.autoApplyStageChanges && confident && !isTerminal;

      if (!canAuto) {
        await createSuggestion({
          clientId: ctx.client.id,
          kind: 'STAGE_CHANGE',
          confidence,
          payload: { toStageKey: action.toStageKey, fromStageKey: ctx.client.stageKey },
          rationale: isTerminal
            ? `${action.reason}. This stage always needs a person to confirm.`
            : !confident
              ? `${action.reason}. Confidence ${(confidence * 100).toFixed(0)}% was below the threshold.`
              : action.reason,
          messageId: ctx.message?.id,
          expiresInHours: 168,
        });
        return 'suggested';
      }

      const moved = await moveClientToStage(SYSTEM_ACTOR, {
        clientId: ctx.client.id,
        toStageKey: action.toStageKey,
        reason: action.reason,
        changedBy: 'ai',
        confidence,
      });
      return moved.moved ? 'applied' : 'skipped';
    }

    // --- Never applied automatically ---------------------------------------
    case 'suggest_reply': {
      if (!ctx.settings.suggestRepliesEnabled) return 'skipped';
      await createSuggestion({
        clientId: ctx.client.id,
        kind: 'REPLY_DRAFT',
        confidence,
        payload: { text: action.text, conversationId: ctx.conversation?.id },
        rationale: 'Draft reply for review',
        messageId: ctx.message?.id,
        expiresInHours: 48,
      });
      return 'suggested';
    }

    default:
      return 'skipped';
  }
}

function actionSignature(action: WorkflowAction): string {
  switch (action.type) {
    case 'move_stage':
      return `move_stage:${action.toStageKey}`;
    case 'create_task':
      return `create_task:${action.dedupeSuffix}`;
    case 'create_follow_up':
      return `create_follow_up:${action.dedupeSuffix}`;
    case 'label_conversation':
      return `label:${action.label}:${action.present}`;
    case 'notify':
      return `notify:${action.event}`;
    case 'set_priority':
      return `priority:${action.priority}`;
    default:
      return action.type;
  }
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

/**
 * Build the workflow context for a message. Kept here (rather than in the job
 * handler) so tests can construct a context the same way production does.
 */
export async function buildContext(messageId: string): Promise<WorkflowContext | null> {
  const message = await db.message.findUnique({
    where: { id: messageId },
    include: {
      analysis: true,
      attachments: { select: { id: true } },
      conversation: { select: { id: true, labels: true } },
      client: { include: { stage: true } },
    },
  });
  if (!message) return null;

  // Make sure the checklist exists before the rules read it. A lead created
  // straight from an inbound WhatsApp message has never been through the
  // client form, so without this the engine would believe nothing is
  // outstanding and would never ask for a licence.
  await ensureChecklist(message.clientId).catch((e) => {
    logger.error({ err: e, clientId: message.clientId }, 'Could not reconcile checklist');
  });

  const [outstanding, quoteCounts, settings] = await Promise.all([
    outstandingItems(message.clientId),
    db.quote.findMany({
      where: { clientId: message.clientId },
      select: { isSelected: true, status: { select: { isProvided: true } } },
    }),
    getSettings([
      'automation.autoRequestDocuments',
      'ai.autoApplyStageChanges',
      'ai.stageChangeMinConfidence',
      'followups.priceObjectionFollowUpHours',
      'followups.quoteProvidedFollowUpHours',
      'followups.thinkingAboutItDays',
      'ai.suggestRepliesEnabled',
    ]),
  ]);

  return {
    client: {
      id: message.client.id,
      displayName: message.client.displayName,
      phone: message.client.phone,
      stageKey: message.client.stage.key,
      stageCategory: message.client.stage.category,
      assignedUserId: message.client.assignedUserId,
      products: message.client.products,
      lastInboundAt: message.client.lastInboundAt,
      lastOutboundAt: message.client.lastOutboundAt,
    },
    conversation: message.conversation
      ? { id: message.conversation.id, labels: message.conversation.labels }
      : null,
    message: {
      id: message.id,
      body: message.body,
      contentType: message.contentType,
      hasAttachments: message.attachments.length > 0,
    },
    analysis: message.analysis
      ? {
          intent: message.analysis.intent,
          confidence: message.analysis.confidence,
          sentiment: message.analysis.sentiment ?? 'neutral',
          urgency: message.analysis.urgency,
          entities: (message.analysis.entities ?? {}) as Record<string, unknown>,
        }
      : null,
    outstandingDocuments: outstanding.map((o) => ({
      documentTypeId: o.documentTypeId,
      name: o.documentType.name,
    })),
    quotes: {
      total: quoteCounts.length,
      provided: quoteCounts.filter((q) => q.status.isProvided).length,
      selected: quoteCounts.some((q) => q.isSelected),
    },
    settings: {
      autoRequestDocuments: settings['automation.autoRequestDocuments'],
      autoApplyStageChanges: settings['ai.autoApplyStageChanges'],
      stageChangeMinConfidence: settings['ai.stageChangeMinConfidence'],
      priceObjectionFollowUpHours: settings['followups.priceObjectionFollowUpHours'],
      quoteProvidedFollowUpHours: settings['followups.quoteProvidedFollowUpHours'],
      thinkingAboutItDays: settings['followups.thinkingAboutItDays'],
      suggestRepliesEnabled: settings['ai.suggestRepliesEnabled'],
    },
  };
}
