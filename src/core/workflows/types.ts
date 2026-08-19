import type { Priority } from '@/lib/types';

/**
 * The workflow contract.
 *
 * Rules are pure: they look at a context and return a list of *proposed*
 * actions. They never touch the database. The engine decides which proposals
 * become real changes and which become suggestions for a human — that
 * separation is what makes the rules readable and testable, and what keeps the
 * "AI cannot act unilaterally" guarantee in one place instead of scattered
 * through twenty call sites.
 */

export interface WorkflowContext {
  client: {
    id: string;
    displayName: string;
    phone: string;
    stageKey: string;
    stageCategory: string;
    assignedUserId: string | null;
    products: string[];
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
  };
  conversation: {
    id: string;
    labels: string[];
  } | null;
  message: {
    id: string;
    body: string | null;
    contentType: string;
    hasAttachments: boolean;
  } | null;
  analysis: {
    intent: string;
    confidence: number;
    sentiment: string;
    urgency: Priority;
    entities: Record<string, unknown>;
    suggestedReply?: string;
  } | null;
  /** Names of required documents we are still waiting for. */
  outstandingDocuments: Array<{ documentTypeId: string; name: string }>;
  quotes: { total: number; provided: number; selected: boolean };
  settings: {
    autoRequestDocuments: boolean;
    autoApplyStageChanges: boolean;
    stageChangeMinConfidence: number;
    priceObjectionFollowUpHours: number;
    quoteProvidedFollowUpHours: number;
    thinkingAboutItDays: number;
    suggestRepliesEnabled: boolean;
  };
}

export type WorkflowAction =
  | { type: 'move_stage'; toStageKey: string; reason: string }
  | {
      type: 'create_task';
      title: string;
      description?: string;
      taskTypeKey?: string;
      priority?: Priority;
      dueInHours?: number;
      dedupeSuffix: string;
    }
  | {
      type: 'create_follow_up';
      reasonKey: string;
      reason?: string;
      dueInHours: number;
      priority?: Priority;
      dedupeSuffix: string;
    }
  | { type: 'request_documents'; documentTypeIds?: string[] }
  | { type: 'label_conversation'; label: string; present: boolean }
  | { type: 'flag_attention'; reason: string }
  | { type: 'clear_attention' }
  | { type: 'set_priority'; priority: Priority }
  | { type: 'suggest_reply'; text: string }
  | { type: 'notify'; event: string; title: string; body?: string; severity?: 'INFO' | 'WARNING' | 'CRITICAL' };

export interface WorkflowRule {
  key: string;
  description: string;
  /** Higher runs first; ties broken by declaration order. */
  priority: number;
  matches(ctx: WorkflowContext): boolean;
  actions(ctx: WorkflowContext): WorkflowAction[];
  /**
   * When false, actions from this rule always become suggestions regardless of
   * confidence. Used for anything with business consequence.
   */
  autoApplyAllowed?: boolean;
}
