import { describe, expect, it } from 'vitest';
import { INTENTS } from '@/integrations/ai/vocabulary';
import { matchingRules, WORKFLOW_RULES } from '@/core/workflows/rules';
import type { WorkflowContext } from '@/core/workflows/types';

/**
 * Workflow rule tests.
 *
 * These are the highest-value tests in the codebase: the rules decide what the
 * CRM does to a client's file when a message arrives, and a mistake here is
 * invisible until a customer is annoyed or a lead is lost. The rules are pure
 * functions specifically so they can be tested without a database.
 */

function context(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    client: {
      id: 'client-1',
      displayName: 'Test Client',
      phone: '+14165550100',
      stageKey: 'new_lead',
      stageCategory: 'OPEN',
      assignedUserId: 'user-1',
      products: ['auto'],
      lastInboundAt: new Date(),
      lastOutboundAt: null,
      ...overrides.client,
    },
    conversation: { id: 'conv-1', labels: [], ...overrides.conversation },
    message: {
      id: 'msg-1',
      body: 'hello',
      contentType: 'TEXT',
      hasAttachments: false,
      ...overrides.message,
    },
    analysis: overrides.analysis === undefined
      ? {
          intent: INTENTS.QUOTE_REQUEST,
          confidence: 0.95,
          sentiment: 'neutral',
          urgency: 'NORMAL',
          entities: {},
        }
      : overrides.analysis,
    outstandingDocuments: overrides.outstandingDocuments ?? [
      { documentTypeId: 'dt-1', name: "Driver's Licence" },
    ],
    quotes: overrides.quotes ?? { total: 0, provided: 0, selected: false },
    settings: {
      autoRequestDocuments: true,
      autoApplyStageChanges: true,
      stageChangeMinConfidence: 0.85,
      priceObjectionFollowUpHours: 4,
      quoteProvidedFollowUpHours: 24,
      thinkingAboutItDays: 3,
      suggestRepliesEnabled: true,
      ...overrides.settings,
    },
  };
}

describe('rule definitions', () => {
  it('has unique keys', () => {
    const keys = WORKFLOW_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never produces an action that binds a policy or prices a risk', () => {
    // The regulated actions must not be reachable from a rule at all — the
    // action union has no case for them, and this asserts nobody adds one.
    for (const rule of WORKFLOW_RULES) {
      const actions = rule.actions(context());
      for (const action of actions) {
        expect(action.type).not.toMatch(/bind|price|underwrit|coverage/i);
      }
    }
  });

  it('marks consequential rules as requiring human approval', () => {
    const humanOnly = ['ready_to_bind', 'not_interested', 'payment_question', 'ai_uncertain'];
    for (const key of humanOnly) {
      const rule = WORKFLOW_RULES.find((r) => r.key === key);
      expect(rule, `rule ${key} should exist`).toBeDefined();
      expect(rule!.autoApplyAllowed, `rule ${key} must not auto-apply`).toBe(false);
    }
  });
});

describe('quote request', () => {
  const rules = matchingRules(context({ analysis: { intent: INTENTS.QUOTE_REQUEST, confidence: 0.95, sentiment: 'neutral', urgency: 'NORMAL', entities: {} } }));

  it('matches the quote_request rule', () => {
    expect(rules.map((r) => r.key)).toContain('quote_request');
  });

  it('moves the client to quote requested and asks for documents', () => {
    const rule = rules.find((r) => r.key === 'quote_request')!;
    const actions = rule.actions(context());
    expect(actions).toContainEqual(
      expect.objectContaining({ type: 'move_stage', toStageKey: 'quote_requested' }),
    );
    expect(actions).toContainEqual(expect.objectContaining({ type: 'request_documents' }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'create_task' }));
  });

  it('does not ask for documents when the checklist is already complete', () => {
    const rule = WORKFLOW_RULES.find((r) => r.key === 'quote_request')!;
    const actions = rule.actions(context({ outstandingDocuments: [] }));
    expect(actions.some((a) => a.type === 'request_documents')).toBe(false);
  });

  it('does not ask for documents when the setting is off', () => {
    const rule = WORKFLOW_RULES.find((r) => r.key === 'quote_request')!;
    const actions = rule.actions(context({ settings: { autoRequestDocuments: false } as never }));
    expect(actions.some((a) => a.type === 'request_documents')).toBe(false);
  });
});

describe('price objection', () => {
  it('creates a follow-up and a task, and flags the client', () => {
    const ctx = context({
      analysis: {
        intent: INTENTS.PRICE_OBJECTION,
        confidence: 0.9,
        sentiment: 'negative',
        urgency: 'HIGH',
        entities: {},
      },
    });
    const rule = matchingRules(ctx).find((r) => r.key === 'price_objection')!;
    const actions = rule.actions(ctx);

    expect(actions).toContainEqual(
      expect.objectContaining({ type: 'create_follow_up', reasonKey: 'price_objection' }),
    );
    expect(actions).toContainEqual(
      expect.objectContaining({ type: 'create_task', taskTypeKey: 'check_alternative_company' }),
    );
    expect(actions).toContainEqual(expect.objectContaining({ type: 'flag_attention' }));
  });

  it('schedules the follow-up using the configured window', () => {
    const ctx = context({
      analysis: {
        intent: INTENTS.PRICE_OBJECTION,
        confidence: 0.9,
        sentiment: 'negative',
        urgency: 'HIGH',
        entities: {},
      },
      settings: { priceObjectionFollowUpHours: 12 } as never,
    });
    const rule = WORKFLOW_RULES.find((r) => r.key === 'price_objection')!;
    const followUp = rule.actions(ctx).find((a) => a.type === 'create_follow_up');
    expect(followUp).toMatchObject({ dueInHours: 12 });
  });
});

describe('ready to bind', () => {
  const ctx = context({
    analysis: {
      intent: INTENTS.READY_TO_BIND,
      confidence: 0.97,
      sentiment: 'positive',
      urgency: 'HIGH',
      entities: {},
    },
  });

  it('escalates rather than acting', () => {
    const rule = matchingRules(ctx).find((r) => r.key === 'ready_to_bind')!;
    expect(rule.autoApplyAllowed).toBe(false);

    const actions = rule.actions(ctx);
    expect(actions).toContainEqual(
      expect.objectContaining({ type: 'create_task', taskTypeKey: 'bind_policy' }),
    );
    expect(actions).toContainEqual(
      expect.objectContaining({ type: 'notify', severity: 'CRITICAL' }),
    );
  });

  it('outranks the generic positive-signal rule', () => {
    const matched = matchingRules(ctx);
    const readyIndex = matched.findIndex((r) => r.key === 'ready_to_bind');
    const proceedIndex = matched.findIndex((r) => r.key === 'wants_to_proceed');
    if (proceedIndex !== -1) expect(readyIndex).toBeLessThan(proceedIndex);
  });
});

describe('lost business', () => {
  it('never marks a client lost without a human', () => {
    for (const intent of [INTENTS.NOT_INTERESTED, INTENTS.PURCHASED_ELSEWHERE]) {
      const ctx = context({
        analysis: { intent, confidence: 0.99, sentiment: 'negative', urgency: 'NORMAL', entities: {} },
      });
      const rule = matchingRules(ctx).find((r) => r.key === 'not_interested')!;
      expect(rule.autoApplyAllowed).toBe(false);
      expect(rule.actions(ctx)).toContainEqual(
        expect.objectContaining({ type: 'move_stage', toStageKey: 'lost' }),
      );
    }
  });
});

describe('uncertainty', () => {
  it('matches when the intent is unknown', () => {
    const ctx = context({
      analysis: { intent: INTENTS.UNKNOWN, confidence: 0.3, sentiment: 'neutral', urgency: 'NORMAL', entities: {} },
    });
    expect(matchingRules(ctx).map((r) => r.key)).toContain('ai_uncertain');
  });

  it('matches when confidence is well below the threshold, even for a known intent', () => {
    const ctx = context({
      analysis: {
        intent: INTENTS.QUOTE_REQUEST,
        confidence: 0.4,
        sentiment: 'neutral',
        urgency: 'NORMAL',
        entities: {},
      },
    });
    expect(matchingRules(ctx).map((r) => r.key)).toContain('ai_uncertain');
  });

  it('runs before everything else so a person sees it', () => {
    const ctx = context({
      analysis: { intent: INTENTS.UNKNOWN, confidence: 0.2, sentiment: 'neutral', urgency: 'NORMAL', entities: {} },
    });
    expect(matchingRules(ctx)[0]?.key).toBe('ai_uncertain');
  });

  it('does not match a confident classification', () => {
    const ctx = context({
      analysis: {
        intent: INTENTS.QUOTE_REQUEST,
        confidence: 0.95,
        sentiment: 'neutral',
        urgency: 'NORMAL',
        entities: {},
      },
    });
    expect(matchingRules(ctx).map((r) => r.key)).not.toContain('ai_uncertain');
  });
});

describe('documents', () => {
  it('advances the stage only once nothing is outstanding', () => {
    const rule = WORKFLOW_RULES.find((r) => r.key === 'sending_documents')!;

    const stillMissing = rule.actions(
      context({
        analysis: { intent: INTENTS.SENDING_DOCUMENTS, confidence: 0.9, sentiment: 'neutral', urgency: 'NORMAL', entities: {} },
      }),
    );
    expect(stillMissing.some((a) => a.type === 'move_stage')).toBe(false);
    expect(stillMissing).toContainEqual(
      expect.objectContaining({ type: 'label_conversation', label: 'missing_documents', present: true }),
    );

    const complete = rule.actions(
      context({
        outstandingDocuments: [],
        analysis: { intent: INTENTS.SENDING_DOCUMENTS, confidence: 0.9, sentiment: 'neutral', urgency: 'NORMAL', entities: {} },
      }),
    );
    expect(complete).toContainEqual(
      expect.objectContaining({ type: 'move_stage', toStageKey: 'documents_received' }),
    );
  });

  it('treats a bare attachment on an open file as documents arriving', () => {
    const ctx = context({
      analysis: null,
      message: { id: 'm', body: null, contentType: 'IMAGE', hasAttachments: true },
    });
    expect(matchingRules(ctx).map((r) => r.key)).toContain('sending_documents');
  });
});

describe('rule safety', () => {
  it('produces no actions at all when there is no analysis and no attachment', () => {
    const ctx = context({
      analysis: null,
      message: { id: 'm', body: null, contentType: 'TEXT', hasAttachments: false },
    });
    expect(matchingRules(ctx)).toHaveLength(0);
  });

  it('every matching rule returns serialisable actions', () => {
    for (const intent of Object.values(INTENTS)) {
      const ctx = context({
        analysis: { intent, confidence: 0.9, sentiment: 'neutral', urgency: 'NORMAL', entities: {} },
      });
      for (const rule of matchingRules(ctx)) {
        expect(() => JSON.stringify(rule.actions(ctx))).not.toThrow();
      }
    }
  });
});
