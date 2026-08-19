import type {
  AiProvider,
  AnalyzeDocumentInput,
  AnalyzeDocumentResult,
  ExtractedField,
  UnderstandMessageInput,
  UnderstandMessageResult,
} from './types';
import { EXTRACTORS, INTENTS, type Intent } from './vocabulary';

/**
 * Deterministic, offline stand-in for the AI provider.
 *
 * It exists so the entire CRM — workflows, checklists, suggestion review,
 * dashboards — can be developed, demoed and tested without an OpenAI key and
 * without spending money on every hot reload. The rules are intentionally
 * simple keyword matching: good enough to exercise every downstream code path,
 * obviously not good enough to ship customer-facing.
 *
 * Confidences are deliberately varied, including some below the auto-apply
 * threshold, so the "AI is uncertain — needs review" paths get exercised too.
 */

interface Rule {
  intent: Intent;
  patterns: RegExp[];
  confidence: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  urgency?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

// Order matters: the first rule that matches wins.
const RULES: Rule[] = [
  {
    intent: INTENTS.READY_TO_BIND,
    patterns: [
      /\b(let'?s do it|go ahead|i'?ll take it|sign me up|start the policy|bind it|i want to buy|ready to (buy|start|purchase))\b/i,
      /\b(where do i pay|how do i pay|send me the (papers|documents) to sign)\b/i,
    ],
    confidence: 0.93,
    sentiment: 'positive',
    urgency: 'HIGH',
  },
  {
    intent: INTENTS.PURCHASED_ELSEWHERE,
    patterns: [/\b(went with|got it from|bought (it )?(from|with)|already (insured|bought|purchased))\b/i, /\banother broker\b/i],
    confidence: 0.88,
    sentiment: 'negative',
  },
  {
    intent: INTENTS.NOT_INTERESTED,
    patterns: [/\b(not interested|no thanks|stop (contacting|messaging)|don'?t contact|unsubscribe|changed my mind)\b/i],
    confidence: 0.9,
    sentiment: 'negative',
  },
  {
    intent: INTENTS.PRICE_OBJECTION,
    patterns: [
      /\b(too (expensive|much|high)|that'?s a lot|can'?t afford|cheaper|lower price|any discount|better rate|pricey)\b/i,
    ],
    confidence: 0.87,
    sentiment: 'negative',
    urgency: 'HIGH',
  },
  {
    intent: INTENTS.REQUESTING_ALTERNATIVE_QUOTE,
    patterns: [/\b(another (quote|company|option)|different (company|insurer)|other options|shop around|try (aviva|intact|pembridge|echelon|economical))\b/i],
    confidence: 0.84,
  },
  {
    intent: INTENTS.SENDING_DOCUMENTS,
    patterns: [
      /\b(here'?s? (my|the)|sending|attached|sent you)\b.*\b(licen[cs]e|ownership|cheque|check|document|permit|photo|certificate)\b/i,
      /\b(licen[cs]e|ownership|void cheque|registration)\b\s*(is )?(attached|here|below)?$/i,
    ],
    confidence: 0.86,
  },
  {
    intent: INTENTS.QUOTE_REQUEST,
    patterns: [
      /\b(need|want|looking for|get me|can i get|how much (is|for|would))\b.*\b(insurance|quote|coverage|policy|rate)\b/i,
      /\b(insurance quote|car insurance|auto insurance|tenant insurance|home insurance)\b/i,
    ],
    confidence: 0.91,
    sentiment: 'positive',
  },
  {
    intent: INTENTS.REQUESTING_FOLLOW_UP,
    patterns: [
      /\b(call me|reach me|contact me|get back to me|text me)\b.*\b(later|tomorrow|next week|after|monday|tuesday|wednesday|thursday|friday|evening|morning)\b/i,
      /\b(let me think|need (some )?time|i'?ll get back to you|give me a (day|few days)|think about it)\b/i,
    ],
    confidence: 0.83,
  },
  {
    intent: INTENTS.CHANGE_INFORMATION,
    patterns: [/\b(actually|correction|i made a mistake|change (my|the)|update (my|the)|wrong (address|date|name|number))\b/i],
    confidence: 0.79,
  },
  {
    intent: INTENTS.PAYMENT_QUESTION,
    patterns: [/\b(payment|billing|invoice|installment|monthly|charged|refund|credit card|pre-?authorized)\b/i],
    confidence: 0.76,
  },
  {
    intent: INTENTS.RENEWAL_ENQUIRY,
    patterns: [/\b(renew|renewal|expiring|expires (soon|next)|my policy ends)\b/i],
    confidence: 0.85,
  },
  {
    intent: INTENTS.COMPLAINT,
    patterns: [/\b(no one (called|replied|answered)|still waiting|unacceptable|terrible service|very disappointed|complaint)\b/i],
    confidence: 0.82,
    sentiment: 'negative',
    urgency: 'URGENT',
  },
  {
    intent: INTENTS.WANTS_TO_PROCEED,
    patterns: [/\b(sounds good|that works|ok(ay)?,? let'?s|i like (that|the)|interested|yes please)\b/i],
    confidence: 0.74,
    sentiment: 'positive',
  },
  {
    intent: INTENTS.PROVIDING_INFORMATION,
    patterns: [
      /\b(my name is|i live at|i'?m \d{2}|born|date of birth|dob)\b/i,
      /\b(19|20)\d{2}\s+\w+\s+\w+/i, // "2019 Honda Civic"
      /\b[A-Z]\d{4}-\d{5}-\d{5}\b/, // Ontario licence pattern
    ],
    confidence: 0.72,
  },
  {
    intent: INTENTS.NEEDS_ASSISTANCE,
    patterns: [/\b(help|confused|don'?t understand|not sure how|stuck)\b/i],
    confidence: 0.7,
  },
  {
    intent: INTENTS.ASKING_QUESTION,
    patterns: [/\?\s*$/, /\b(what|when|why|how|does|do you|can you|is it|are there)\b/i],
    confidence: 0.68,
  },
  {
    intent: INTENTS.GREETING,
    patterns: [/^\s*(hi|hello|hey|good (morning|afternoon|evening)|salaam|bonjour)[\s!.,]*$/i],
    confidence: 0.95,
  },
];

const REPLY_DRAFTS: Partial<Record<Intent, string>> = {
  [INTENTS.QUOTE_REQUEST]:
    "Happy to help with that. To start your quote, could you send a photo of your driver's licence and your vehicle ownership?",
  [INTENTS.PRICE_OBJECTION]:
    "Thanks for letting me know. I'll check a few other companies and see what else I can find for you.",
  [INTENTS.SENDING_DOCUMENTS]: "Got it, thank you. I'll review this and let you know if anything else is needed.",
  [INTENTS.READY_TO_BIND]:
    "That's great. One of our licensed brokers will confirm the details with you and get everything finalised.",
  [INTENTS.REQUESTING_FOLLOW_UP]: "No problem at all — I'll follow up with you then.",
  [INTENTS.ASKING_QUESTION]: "Good question — let me check on that and come right back to you.",
  [INTENTS.GREETING]: 'Hello! How can I help you today?',
};

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async understandMessage(input: UnderstandMessageInput): Promise<UnderstandMessageResult> {
    const started = Date.now();
    const text = (input.text ?? '').trim();

    let matched: Rule | null = null;
    for (const rule of RULES) {
      if (rule.patterns.some((p) => p.test(text))) {
        matched = rule;
        break;
      }
    }

    // Very short messages are genuinely ambiguous — reflect that in confidence
    // so the "AI uncertain" review queue gets real traffic in dev.
    const lengthPenalty = text.length < 12 ? 0.25 : text.length < 25 ? 0.1 : 0;
    const intent = matched?.intent ?? INTENTS.UNKNOWN;
    const confidence = matched ? Math.max(0.3, matched.confidence - lengthPenalty) : 0.35;

    const secondary = RULES.filter((r) => r !== matched && r.patterns.some((p) => p.test(text)))
      .slice(0, 2)
      .map((r) => ({ intent: r.intent, confidence: Math.max(0.2, r.confidence - 0.35) }));

    return {
      intent,
      confidence,
      secondaryIntents: secondary,
      sentiment: matched?.sentiment ?? 'neutral',
      urgency: matched?.urgency ?? 'NORMAL',
      language: 'en',
      entities: extractEntities(text),
      summary: summarize(text),
      suggestedReply: REPLY_DRAFTS[intent],
      meta: {
        provider: this.name,
        model: 'rules-v1',
        promptVersion: 'mock-v1',
        latencyMs: Date.now() - started,
      },
    };
  }

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<AnalyzeDocumentResult> {
    const started = Date.now();
    const name = (input.filename ?? '').toLowerCase();

    const guess =
      input.expectedTypeKey ??
      (/licen[cs]e|dl|permit/.test(name)
        ? 'drivers_licence'
        : /ownership|registration|vehicle/.test(name)
          ? 'vehicle_ownership'
          : /cheque|check|void|deposit/.test(name)
            ? 'void_cheque'
            : /tire|tyre/.test(name)
              ? 'winter_tire_photo'
              : /training|bde|certificate/.test(name)
                ? 'driver_training'
                : 'generic');

    const spec = EXTRACTORS[guess] ?? EXTRACTORS.generic!;
    const fields: Record<string, ExtractedField> = {};

    // Produce plausible-looking sample values so the verification UI has
    // something to render. Clearly fake — nothing here should be trusted.
    const samples: Record<string, string | number | boolean> = {
      fullName: 'SAMPLE, MOCK A',
      address: '123 Sample Street',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M4B 1B3',
      dateOfBirth: '1990-04-12',
      licenceNumber: 'S1234-56789-01234',
      licenceClass: 'G',
      expiryDate: '2028-04-12',
      issueDate: '2020-04-12',
      ownerName: 'SAMPLE, MOCK A',
      vin: '1HGCM82633A004352',
      plate: 'ABCD123',
      year: 2019,
      make: 'Honda',
      model: 'Civic',
      accountHolder: 'Mock A Sample',
      institutionNumber: '003',
      transitNumber: '12345',
      accountNumber: '1234567',
      bankName: 'Sample Bank of Canada',
      studentName: 'Mock A Sample',
      completionDate: '2021-06-30',
      schoolName: 'Sample Driving Academy',
      insurerName: 'Sample Insurance Co.',
      policyNumber: 'POL-000123',
      effectiveDate: '2025-01-01',
      annualPremium: 1840,
      hasSnowflakeSymbol: true,
      tireBrand: 'Sample Tires',
      documentTitle: 'Sample Document',
      personName: 'Mock A Sample',
      documentDate: '2026-01-15',
      summary: 'A mock document generated by the offline AI provider.',
    };

    for (const f of spec.fields) {
      const value = samples[f.key];
      if (value === undefined) continue;
      // Vary confidence so the low-confidence review path is exercised.
      const confidence = f.key === 'expiryDate' || f.key === 'postalCode' ? 0.71 : 0.93;
      fields[f.key] = { value, confidence };
    }

    return {
      detectedTypeKey: spec.key,
      detectionConfidence: input.expectedTypeKey ? 0.95 : 0.72,
      fields,
      confidence: 0.86,
      warnings: ['Generated by the mock AI provider — values are not real.'],
      rawResponse: { mock: true, extractor: spec.key },
      meta: {
        provider: this.name,
        model: 'rules-v1',
        promptVersion: 'mock-v1',
        latencyMs: Date.now() - started,
      },
    };
  }
}

function extractEntities(text: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};

  const price = text.match(/\$\s?(\d[\d,]*(?:\.\d{2})?)/);
  if (price?.[1]) entities.mentionedPrice = Number(price[1].replace(/,/g, ''));

  const vehicle = text.match(/\b((?:19|20)\d{2})\s+([A-Za-z]+)\s+([A-Za-z0-9-]+)/);
  if (vehicle) {
    entities.vehicles = [{ year: Number(vehicle[1]), make: vehicle[2], model: vehicle[3] }];
  }

  const company = text.match(/\b(aviva|intact|pembridge|echelon|economical|wawanesa|gore mutual|travelers)\b/i);
  if (company?.[1]) entities.requestedCompany = company[1];

  const docs: string[] = [];
  if (/licen[cs]e/i.test(text)) docs.push('drivers_licence');
  if (/ownership|registration/i.test(text)) docs.push('vehicle_ownership');
  if (/cheque|check|deposit/i.test(text)) docs.push('void_cheque');
  if (docs.length) entities.documentsMentioned = docs;

  const products: string[] = [];
  if (/\b(car|auto|vehicle)\b/i.test(text)) products.push('auto');
  if (/\b(home|house|property)\b/i.test(text)) products.push('home');
  if (/\b(tenant|renter|apartment)\b/i.test(text)) products.push('tenant');
  if (products.length) entities.products = products;

  return entities;
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= 90 ? clean : `${clean.slice(0, 89)}…`;
}
