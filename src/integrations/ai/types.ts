/**
 * AI provider abstraction.
 *
 * Two capabilities, deliberately kept separate:
 *   1. understandMessage  — text -> structured intent + entities
 *   2. analyzeDocument    — image/PDF -> document type + extracted fields
 *
 * The provider only ever *describes* what it sees. It never decides what the
 * CRM does about it: that is the workflow engine's job (src/core/workflows),
 * which applies business rules and confidence thresholds. This split is what
 * keeps regulated decisions — binding, coverage, eligibility, pricing — out of
 * the model's hands.
 */

export interface UnderstandMessageInput {
  /** The message we are classifying. */
  text: string;
  /** Recent conversation for context, oldest first. Keep it short. */
  history?: Array<{ direction: 'inbound' | 'outbound'; text: string }>;
  /** Non-identifying client context that improves classification. */
  clientContext?: {
    stageKey?: string;
    hasOpenQuote?: boolean;
    missingDocuments?: string[];
    products?: string[];
  };
}

export interface UnderstandMessageResult {
  /** Canonical key from src/core/ai/intents.ts. */
  intent: string;
  confidence: number;
  secondaryIntents: Array<{ intent: string; confidence: number }>;
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  language?: string;
  /** Anything structured the model could pull out of the text. */
  entities: Record<string, unknown>;
  /** One-line human summary shown in the conversation list. */
  summary?: string;
  /** Optional drafted reply — never sent without a human unless a rule allows it. */
  suggestedReply?: string;

  meta: ProviderMeta;
}

export interface AnalyzeDocumentInput {
  /** Raw file bytes. */
  body: Buffer;
  mimeType: string;
  filename?: string;
  /** If staff already told us what this is, pass it so the model focuses. */
  expectedTypeKey?: string;
  /** Which extraction schema to run; see src/core/ai/extractors.ts. */
  extractorKey?: string;
}

export interface ExtractedField {
  value: string | number | boolean | null;
  confidence: number;
  /** Optional note, e.g. "date was partially obscured". */
  note?: string;
}

export interface AnalyzeDocumentResult {
  /** Model's guess at the document type key. */
  detectedTypeKey: string | null;
  detectionConfidence: number;
  /** fieldName -> extracted value + confidence. */
  fields: Record<string, ExtractedField>;
  /** Overall confidence in the extraction as a whole. */
  confidence: number;
  warnings: string[];
  rawResponse: unknown;

  meta: ProviderMeta;
}

export interface ProviderMeta {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  tokensUsed?: number;
}

export interface AiProvider {
  readonly name: string;
  understandMessage(input: UnderstandMessageInput): Promise<UnderstandMessageResult>;
  analyzeDocument(input: AnalyzeDocumentInput): Promise<AnalyzeDocumentResult>;
}
