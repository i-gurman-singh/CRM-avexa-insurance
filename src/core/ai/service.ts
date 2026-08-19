import '@/lib/server-guard';
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import { getAi, EXTRACTORS } from '@/integrations/ai';
import { ACTIVITY_TYPES, recordActivity } from '@/core/activity/service';
import { SYSTEM_ACTOR } from '@/core/context';
import { markReceived } from '@/core/documents/checklist';
import { applyExtraction } from '@/core/documents/apply';
import { setConversationLabel } from '@/core/messaging/service';
import { getSettings } from '@/core/settings/service';
import { buildContext, evaluateWorkflows } from '@/core/workflows/engine';
import { createSuggestion } from './suggestions';

const logger = log('ai:service');

/**
 * AI orchestration.
 *
 * This is the seam between "the model said something" and "the CRM did
 * something". It stores the analysis, then hands off to the workflow engine,
 * which applies business rules. The model's output is never applied directly
 * from here.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function analyzeMessage(messageId: string): Promise<void> {
  const settings = await getSettings(['ai.enabled', 'ai.uncertaintyThreshold', 'ai.suggestRepliesEnabled']);

  const message = await db.message.findUnique({
    where: { id: messageId },
    include: {
      client: { include: { stage: true } },
      conversation: { select: { id: true } },
      analysis: true,
    },
  });

  if (!message) {
    logger.warn({ messageId }, 'Message vanished before analysis');
    return;
  }
  if (message.direction !== 'INBOUND') return;
  if (message.analysis) return; // already analysed; jobs can retry safely

  // Non-text messages have nothing to classify. The document pipeline handles
  // attachments separately.
  const text = message.body?.trim();
  if (!settings['ai.enabled'] || !text) {
    if (!text) {
      await db.conversation.update({
        where: { id: message.conversationId },
        data: { state: 'WAITING_ON_US' },
      });
    }
    // Still run workflows: an attachment alone can advance the file.
    await runWorkflowsFor(messageId);
    return;
  }

  const history = await db.message.findMany({
    where: { clientId: message.clientId, id: { not: messageId }, body: { not: null } },
    orderBy: { sentAt: 'desc' },
    take: 8,
    select: { direction: true, body: true },
  });

  const outstanding = await db.documentChecklistItem.findMany({
    where: { clientId: message.clientId, required: true, status: { in: ['NOT_REQUESTED', 'REQUESTED'] } },
    include: { documentType: { select: { name: true } } },
  });

  const quoteCount = await db.quote.count({ where: { clientId: message.clientId } });

  try {
    const result = await getAi().understandMessage({
      text,
      history: history
        .reverse()
        .map((h) => ({
          direction: h.direction === 'INBOUND' ? ('inbound' as const) : ('outbound' as const),
          text: h.body ?? '',
        })),
      clientContext: {
        stageKey: message.client.stage.key,
        hasOpenQuote: quoteCount > 0,
        missingDocuments: outstanding.map((o) => o.documentType.name),
        products: message.client.products,
      },
    });

    await db.messageAnalysis.create({
      data: {
        messageId,
        intent: result.intent,
        confidence: result.confidence,
        sentiment: result.sentiment,
        urgency: result.urgency,
        language: result.language ?? null,
        entities: result.entities as object,
        secondaryIntents: result.secondaryIntents as object,
        summary: result.summary ?? null,
        provider: result.meta.provider,
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        latencyMs: result.meta.latencyMs,
        tokensUsed: result.meta.tokensUsed ?? null,
      },
    });

    // Mark the conversation uncertain so the monitoring filter picks it up.
    const uncertain = result.confidence < settings['ai.uncertaintyThreshold'];
    await db.conversation.update({
      where: { id: message.conversationId },
      data: { aiUncertain: uncertain, state: 'WAITING_ON_US' },
    });
    if (!uncertain) {
      await setConversationLabel(message.conversationId, 'ai_uncertain', false);
    }

    await recordActivity({
      clientId: message.clientId,
      type: ACTIVITY_TYPES.AI_ANALYSED_MESSAGE,
      title: `AI read the message: ${result.intent.replace(/_/g, ' ')}`,
      body: result.summary,
      metadata: { intent: result.intent, confidence: result.confidence, provider: result.meta.provider },
      actor: SYSTEM_ACTOR,
      actorType: 'ai',
      entityType: 'Message',
      entityId: messageId,
    });

    // A drafted reply is always offered, never sent.
    if (settings['ai.suggestRepliesEnabled'] && result.suggestedReply) {
      await createSuggestion({
        clientId: message.clientId,
        kind: 'REPLY_DRAFT',
        confidence: result.confidence,
        payload: { text: result.suggestedReply, conversationId: message.conversationId },
        rationale: 'Draft reply — edit before sending',
        messageId,
        expiresInHours: 48,
      });
    }

    logger.info(
      { messageId, intent: result.intent, confidence: result.confidence },
      'Message analysed',
    );
  } catch (e) {
    // The message is already safely stored; a failed analysis is recoverable.
    logger.error({ err: e, messageId }, 'Message analysis failed');
    await db.messageAnalysis
      .create({
        data: {
          messageId,
          intent: 'unknown',
          confidence: 0,
          entities: {},
          secondaryIntents: [],
          provider: 'error',
          model: 'error',
          error: e instanceof Error ? e.message.slice(0, 500) : 'Unknown error',
        },
      })
      .catch(() => undefined);

    await db.conversation.update({
      where: { id: message.conversationId },
      data: { aiUncertain: true, state: 'WAITING_ON_US' },
    });
  }

  await runWorkflowsFor(messageId);
}

async function runWorkflowsFor(messageId: string) {
  try {
    const ctx = await buildContext(messageId);
    if (ctx) await evaluateWorkflows(ctx);
  } catch (e) {
    logger.error({ err: e, messageId }, 'Workflow evaluation failed');
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function processDocument(documentId: string, force = false): Promise<void> {
  const settings = await getSettings([
    'ai.documentAnalysisEnabled',
    'ai.uncertaintyThreshold',
    'automation.autoRequestDocuments',
  ]);

  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { documentType: true },
  });
  if (!document) return;
  if (document.processingStatus === 'PROCESSED' && !force) return;

  if (!settings['ai.documentAnalysisEnabled']) {
    await db.document.update({ where: { id: documentId }, data: { processingStatus: 'SKIPPED' } });
    return;
  }

  // Only images and PDFs can be read; everything else is stored as-is.
  const readable = /^(image\/|application\/pdf)/.test(document.mimeType);
  if (!readable) {
    await db.document.update({
      where: { id: documentId },
      data: { processingStatus: 'SKIPPED', notes: 'File type not supported for extraction' },
    });
    return;
  }

  await db.document.update({ where: { id: documentId }, data: { processingStatus: 'PROCESSING' } });

  try {
    const { getStorage } = await import('@/integrations/storage');
    const object = await getStorage().get(document.storageKey);

    const extractorKey =
      document.documentType?.extractorKey ??
      (document.documentType ? 'generic' : undefined);

    const result = await getAi().analyzeDocument({
      body: object.body,
      mimeType: document.mimeType,
      filename: document.filename,
      expectedTypeKey: document.documentType?.key,
      extractorKey: extractorKey ?? guessExtractorFromFilename(document.filename),
    });

    const extraction = await db.documentExtraction.create({
      data: {
        documentId,
        extractorKey: result.detectedTypeKey ?? extractorKey ?? 'generic',
        provider: result.meta.provider,
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        fields: result.fields as object,
        rawResponse: result.rawResponse as object,
        confidence: result.confidence,
        warnings: result.warnings,
        latencyMs: result.meta.latencyMs,
        tokensUsed: result.meta.tokensUsed ?? null,
      },
    });

    // Attach a document type if AI recognised one and staff hadn't set one.
    let documentTypeId = document.documentTypeId;
    if (!documentTypeId && result.detectedTypeKey) {
      const matched = await db.documentType.findUnique({ where: { key: result.detectedTypeKey } });
      if (matched && result.detectionConfidence >= settings['ai.uncertaintyThreshold']) {
        documentTypeId = matched.id;
      }
    }

    await db.document.update({
      where: { id: documentId },
      data: {
        processingStatus: 'PROCESSED',
        detectedTypeKey: result.detectedTypeKey,
        detectionConfidence: result.detectionConfidence,
        documentTypeId,
        // Low-confidence reads are explicitly flagged for a person.
        verificationStatus:
          result.confidence < settings['ai.uncertaintyThreshold'] || result.warnings.length
            ? 'NEEDS_REVIEW'
            : 'UNVERIFIED',
      },
    });

    if (documentTypeId) {
      await markReceived(document.clientId, documentTypeId, documentId);
    }

    // Fill empty fields, suggest the rest.
    const applied = await applyExtraction(SYSTEM_ACTOR, documentId, extraction.id);

    await recordActivity({
      clientId: document.clientId,
      type: ACTIVITY_TYPES.AI_EXTRACTED_DOCUMENT,
      title: `AI read ${document.documentType?.name ?? result.detectedTypeKey ?? 'a document'}`,
      body:
        applied.applied.length || applied.suggested.length
          ? `Filled ${applied.applied.length}, ${applied.suggested.length} awaiting review`
          : 'No usable fields found',
      metadata: {
        detectedTypeKey: result.detectedTypeKey,
        confidence: result.confidence,
        warnings: result.warnings,
      },
      actor: SYSTEM_ACTOR,
      actorType: 'ai',
      entityType: 'Document',
      entityId: documentId,
    });

    // Now that the checklist may have changed, re-check whether we still need
    // anything and ask for it.
    await maybeRequestRemainingDocuments(document.clientId, settings['automation.autoRequestDocuments']);

    logger.info(
      { documentId, detected: result.detectedTypeKey, applied: applied.applied.length },
      'Document processed',
    );
  } catch (e) {
    logger.error({ err: e, documentId }, 'Document processing failed');
    await db.document.update({
      where: { id: documentId },
      data: {
        processingStatus: 'FAILED',
        verificationStatus: 'NEEDS_REVIEW',
        notes: e instanceof Error ? e.message.slice(0, 500) : 'Processing failed',
      },
    });
    throw e; // let the queue retry
  }
}

async function maybeRequestRemainingDocuments(clientId: string, enabled: boolean) {
  if (!enabled) return;
  try {
    const { requestDocuments } = await import('@/core/workflows/documentRequests');
    await requestDocuments(SYSTEM_ACTOR, clientId);
  } catch (e) {
    logger.error({ err: e, clientId }, 'Follow-on document request failed');
  }
}

function guessExtractorFromFilename(filename: string): string {
  const name = filename.toLowerCase();
  for (const key of Object.keys(EXTRACTORS)) {
    if (key !== 'generic' && name.includes(key.split('_')[0]!)) return key;
  }
  return 'generic';
}
