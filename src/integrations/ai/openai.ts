import OpenAI from 'openai';
import { env } from '@/lib/env';
import { IntegrationError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type {
  AiProvider,
  AnalyzeDocumentInput,
  AnalyzeDocumentResult,
  ExtractedField,
  UnderstandMessageInput,
  UnderstandMessageResult,
} from './types';
import { EXTRACTORS, INTENT_DESCRIPTIONS, INTENT_LIST, INTENTS, isKnownIntent } from './vocabulary';

const logger = log('ai:openai');

/** Bump when a prompt changes so stored analyses stay comparable over time. */
const MESSAGE_PROMPT_VERSION = 'v1';
const DOCUMENT_PROMPT_VERSION = 'v1';

const MESSAGE_SYSTEM_PROMPT = `You classify WhatsApp messages sent to an Ontario insurance brokerage.

Your ONLY job is to describe what the customer said. You must never decide, imply, or state:
- whether someone is eligible for insurance
- what coverage they should have
- what a policy should cost
- whether a policy should be bound or issued

Those are regulated decisions made by licensed humans. If a message asks for one, classify it and let staff handle it.

Classify into exactly one primary intent from this list:
${INTENT_LIST.map((i) => `- ${i}: ${INTENT_DESCRIPTIONS[i]}`).join('\n')}

Rules:
- If you are not confident, use "unknown" with a low confidence rather than guessing.
- "ready_to_bind" requires an explicit agreement to purchase, not just interest.
- confidence is your honest probability from 0 to 1 that the primary intent is correct.
- Extract only facts the customer actually stated. Never infer or invent values.
- Reply in the same language the customer used when drafting suggestedReply.
- suggestedReply is a draft for a human to review. Never promise a price, coverage, or approval in it.`;

function messageSchema() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: [
      'intent',
      'confidence',
      'secondaryIntents',
      'sentiment',
      'urgency',
      'language',
      'entities',
      'summary',
      'suggestedReply',
    ],
    properties: {
      intent: { type: 'string', enum: INTENT_LIST },
      confidence: { type: 'number' },
      secondaryIntents: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['intent', 'confidence'],
          properties: {
            intent: { type: 'string', enum: INTENT_LIST },
            confidence: { type: 'number' },
          },
        },
      },
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
      urgency: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
      language: { type: 'string' },
      entities: {
        type: 'object',
        additionalProperties: false,
        required: [
          'personName',
          'vehicles',
          'requestedCompany',
          'mentionedPrice',
          'requestedCallbackTime',
          'documentsMentioned',
          'products',
        ],
        properties: {
          personName: { type: ['string', 'null'] },
          vehicles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['year', 'make', 'model'],
              properties: {
                year: { type: ['number', 'null'] },
                make: { type: ['string', 'null'] },
                model: { type: ['string', 'null'] },
              },
            },
          },
          requestedCompany: { type: ['string', 'null'] },
          mentionedPrice: { type: ['number', 'null'] },
          requestedCallbackTime: { type: ['string', 'null'] },
          documentsMentioned: { type: 'array', items: { type: 'string' } },
          products: { type: 'array', items: { type: 'string' } },
        },
      },
      summary: { type: 'string' },
      suggestedReply: { type: ['string', 'null'] },
    },
  };
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the openai provider');
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: 30_000 });
  }

  async understandMessage(input: UnderstandMessageInput): Promise<UnderstandMessageResult> {
    const started = Date.now();
    const model = env.OPENAI_MODEL_TEXT;

    const contextLines: string[] = [];
    if (input.clientContext) {
      const c = input.clientContext;
      if (c.stageKey) contextLines.push(`Current pipeline stage: ${c.stageKey}`);
      if (c.hasOpenQuote) contextLines.push('This client already has a quote on file.');
      if (c.products?.length) contextLines.push(`Products of interest: ${c.products.join(', ')}`);
      if (c.missingDocuments?.length) {
        contextLines.push(`Documents still outstanding: ${c.missingDocuments.join(', ')}`);
      }
    }

    const historyText = (input.history ?? [])
      .slice(-8)
      .map((h) => `${h.direction === 'inbound' ? 'Customer' : 'Broker'}: ${h.text}`)
      .join('\n');

    const userContent = [
      contextLines.length ? `Context:\n${contextLines.join('\n')}` : '',
      historyText ? `Recent conversation:\n${historyText}` : '',
      `Message to classify:\n${input.text}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const res = await this.client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: MESSAGE_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'message_analysis', strict: true, schema: messageSchema() },
        },
      });

      const raw = res.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw);

      return {
        intent: isKnownIntent(parsed.intent) ? parsed.intent : INTENTS.UNKNOWN,
        confidence: clamp01(parsed.confidence),
        secondaryIntents: Array.isArray(parsed.secondaryIntents)
          ? parsed.secondaryIntents
              .filter((s: any) => isKnownIntent(s?.intent))
              .map((s: any) => ({ intent: s.intent, confidence: clamp01(s.confidence) }))
          : [],
        sentiment: parsed.sentiment ?? 'neutral',
        urgency: parsed.urgency ?? 'NORMAL',
        language: parsed.language ?? undefined,
        entities: stripNulls(parsed.entities ?? {}),
        summary: parsed.summary ?? undefined,
        suggestedReply: parsed.suggestedReply ?? undefined,
        meta: {
          provider: this.name,
          model,
          promptVersion: MESSAGE_PROMPT_VERSION,
          latencyMs: Date.now() - started,
          tokensUsed: res.usage?.total_tokens,
        },
      };
    } catch (e: any) {
      logger.error({ err: e }, 'understandMessage failed');
      throw new IntegrationError('openai', e?.message ?? 'Message understanding failed', {
        retryable: e?.status === 429 || (e?.status ?? 0) >= 500,
      });
    }
  }

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<AnalyzeDocumentResult> {
    const started = Date.now();
    const model = env.OPENAI_MODEL_VISION;
    const spec = EXTRACTORS[input.extractorKey ?? ''] ?? EXTRACTORS.generic!;

    const fieldProperties: Record<string, unknown> = {};
    for (const f of spec.fields) {
      fieldProperties[f.key] = {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'confidence'],
        properties: {
          value: { type: ['string', 'number', 'boolean', 'null'], description: f.description },
          confidence: { type: 'number' },
        },
      };
    }

    const schema = {
      type: 'object' as const,
      additionalProperties: false,
      required: ['detectedTypeKey', 'detectionConfidence', 'confidence', 'warnings', 'fields'],
      properties: {
        detectedTypeKey: { type: ['string', 'null'], enum: [...Object.keys(EXTRACTORS), null] },
        detectionConfidence: { type: 'number' },
        confidence: { type: 'number' },
        warnings: { type: 'array', items: { type: 'string' } },
        fields: {
          type: 'object',
          additionalProperties: false,
          required: spec.fields.map((f) => f.key),
          properties: fieldProperties,
        },
      },
    };

    const systemPrompt = `You read documents submitted to an insurance brokerage and transcribe what is printed on them.

Transcribe only. Do not interpret, correct, normalise or complete values you cannot clearly read.
If a field is unreadable or absent, return null with confidence 0. Never guess.
Dates must be ISO format (YYYY-MM-DD). Return numbers as numbers, not strings.
Set a warning if the image is blurry, cropped, partially obscured, or appears to be a different document type than expected.
You must not assess eligibility, risk, coverage or pricing.

Known document types: ${Object.values(EXTRACTORS)
      .map((e) => `${e.key} (${e.description})`)
      .join('; ')}.`;

    const dataUrl = `data:${input.mimeType};base64,${input.body.toString('base64')}`;
    const expectation = input.expectedTypeKey
      ? `Staff expect this to be: ${input.expectedTypeKey}. Confirm or correct that.`
      : 'Identify which known document type this is.';

    try {
      const res = await this.client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: `${expectation}\nExtract the fields defined by the schema.` },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'document_extraction', strict: true, schema },
        },
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      const fields: Record<string, ExtractedField> = {};
      for (const [key, value] of Object.entries(parsed.fields ?? {})) {
        const v = value as any;
        if (v?.value === null || v?.value === undefined || v?.value === '') continue;
        fields[key] = { value: v.value, confidence: clamp01(v.confidence) };
      }

      return {
        detectedTypeKey: parsed.detectedTypeKey ?? null,
        detectionConfidence: clamp01(parsed.detectionConfidence),
        fields,
        confidence: clamp01(parsed.confidence),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        rawResponse: parsed,
        meta: {
          provider: this.name,
          model,
          promptVersion: DOCUMENT_PROMPT_VERSION,
          latencyMs: Date.now() - started,
          tokensUsed: res.usage?.total_tokens,
        },
      };
    } catch (e: any) {
      logger.error({ err: e, extractorKey: spec.key }, 'analyzeDocument failed');
      throw new IntegrationError('openai', e?.message ?? 'Document analysis failed', {
        retryable: e?.status === 429 || (e?.status ?? 0) >= 500,
      });
    }
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}
