import { describe, expect, it } from 'vitest';
import { Dialog360Provider } from '@/integrations/whatsapp/360dialog';
import { MockAiProvider } from '@/integrations/ai/mock';
import { INTENTS } from '@/integrations/ai/vocabulary';

/**
 * Provider adapter tests.
 *
 * The webhook parser is the single place a malformed provider payload can take
 * down message ingestion, so it is tested against real-shaped payloads and
 * against deliberate garbage.
 */

function payload(message: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: '14165551000' },
              contacts: [{ wa_id: '14165550123', profile: { name: 'Jane Doe' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

describe('360dialog webhook parsing', () => {
  const provider = new Dialog360Provider();

  it('parses a text message', () => {
    const result = provider.parseWebhook(
      payload({ id: 'wamid.1', from: '14165550123', type: 'text', timestamp: '1767225600', text: { body: 'I need insurance' } }),
    );

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0]!;
    expect(message.externalId).toBe('wamid.1');
    expect(message.from).toBe('+14165550123');
    expect(message.type).toBe('text');
    expect(message.text).toBe('I need insurance');
    expect(message.profileName).toBe('Jane Doe');
    expect(message.timestamp.getUTCFullYear()).toBe(2026);
  });

  it('parses an image with its caption and media id', () => {
    const result = provider.parseWebhook(
      payload({
        id: 'wamid.2',
        from: '14165550123',
        type: 'image',
        timestamp: '1767225600',
        image: { id: 'media-1', mime_type: 'image/jpeg', caption: "Here's my licence" },
      }),
    );

    const message = result.messages[0]!;
    expect(message.type).toBe('image');
    expect(message.text).toBe("Here's my licence");
    expect(message.attachments[0]).toMatchObject({
      externalMediaId: 'media-1',
      mimeType: 'image/jpeg',
    });
  });

  it('parses a document with its filename', () => {
    const result = provider.parseWebhook(
      payload({
        id: 'wamid.3',
        from: '14165550123',
        type: 'document',
        timestamp: '1767225600',
        document: { id: 'media-2', mime_type: 'application/pdf', filename: 'ownership.pdf' },
      }),
    );

    expect(result.messages[0]!.attachments[0]).toMatchObject({
      externalMediaId: 'media-2',
      filename: 'ownership.pdf',
    });
  });

  it('captures voice-note metadata', () => {
    const result = provider.parseWebhook(
      payload({
        id: 'wamid.4',
        from: '14165550123',
        type: 'audio',
        timestamp: '1767225600',
        audio: { id: 'media-3', mime_type: 'audio/ogg', duration: 12 },
      }),
    );

    expect(result.messages[0]!.type).toBe('audio');
    expect(result.messages[0]!.attachments[0]?.durationSeconds).toBe(12);
  });

  it('parses delivery statuses', () => {
    const result = provider.parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'read', timestamp: '1767225600', recipient_id: '14165550123' },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.statuses[0]).toMatchObject({ externalId: 'wamid.1', status: 'read' });
  });

  it('never throws on a malformed payload — an unparseable webhook must still be acknowledged', () => {
    for (const bad of [null, undefined, {}, { entry: 'not an array' }, { entry: [{ changes: null }] }, 42, 'string']) {
      expect(() => provider.parseWebhook(bad)).not.toThrow();
      const result = provider.parseWebhook(bad);
      expect(result.messages).toEqual([]);
      expect(result.statuses).toEqual([]);
    }
  });

  it('preserves the raw payload so nothing is lost before processing', () => {
    const raw = { id: 'wamid.9', from: '14165550123', type: 'text', timestamp: '1767225600', text: { body: 'hi' } };
    const result = provider.parseWebhook(payload(raw));
    expect(result.messages[0]!.raw).toMatchObject({ id: 'wamid.9' });
  });
});

describe('mock AI classifier', () => {
  const ai = new MockAiProvider();

  const cases: Array<[string, string]> = [
    ['Hi, I need car insurance for my Civic', INTENTS.QUOTE_REQUEST],
    ["That's too expensive, anything cheaper?", INTENTS.PRICE_OBJECTION],
    ["Let's do it, where do I pay?", INTENTS.READY_TO_BIND],
    ['I went with another broker, thanks', INTENTS.PURCHASED_ELSEWHERE],
    ['Not interested, please stop contacting me', INTENTS.NOT_INTERESTED],
    ['Can you call me later this week?', INTENTS.REQUESTING_FOLLOW_UP],
    ["Here's my licence and ownership", INTENTS.SENDING_DOCUMENTS],
    ['Can you try Aviva instead?', INTENTS.REQUESTING_ALTERNATIVE_QUOTE],
  ];

  it.each(cases)('classifies %j', async (text, expected) => {
    const result = await ai.understandMessage({ text });
    expect(result.intent).toBe(expected);
  });

  it('is unsure about a bare greeting rather than guessing a business intent', async () => {
    const result = await ai.understandMessage({ text: 'hi' });
    expect(result.confidence).toBeLessThan(0.85);
  });

  it('extracts a mentioned price and vehicle', async () => {
    const result = await ai.understandMessage({
      text: 'I have a 2019 Honda Civic and my current rate is $180 a month',
    });
    expect(result.entities.mentionedPrice).toBe(180);
    expect(result.entities.vehicles).toMatchObject([{ year: 2019, make: 'Honda' }]);
  });

  it('returns a confidence between 0 and 1 for every intent', async () => {
    for (const [text] of cases) {
      const result = await ai.understandMessage({ text });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('flags low confidence on some extracted document fields so review paths are exercised', async () => {
    const result = await ai.analyzeDocument({
      body: Buffer.from('x'),
      mimeType: 'image/png',
      filename: 'licence.png',
    });

    expect(result.detectedTypeKey).toBe('drivers_licence');
    expect(Object.keys(result.fields).length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(Object.values(result.fields).some((f) => f.confidence < 0.9)).toBe(true);
  });
});
