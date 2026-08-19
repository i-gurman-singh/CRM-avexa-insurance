import { randomUUID } from 'node:crypto';
import { log, maskPhone } from '@/lib/logger';
import { parseCloudApiWebhook } from './360dialog';
import type {
  MediaDownload,
  NormalizedWebhookEvent,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppProvider,
} from './types';

const logger = log('whatsapp:mock');

/**
 * Offline WhatsApp provider.
 *
 * Outbound messages are logged and recorded in memory instead of being sent,
 * so the full send path (permission check, audit log, activity timeline,
 * delivery status) can be exercised without a live WABA number. Inbound
 * messages can be simulated by POSTing the same normalised shape to
 * /api/webhooks/whatsapp — see docs/WHATSAPP.md.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock';

  /** Everything "sent" during this process — handy in tests and dev tooling. */
  readonly outbox: Array<{ to: string; kind: string; body: string; at: Date }> = [];

  verifyWebhook(): boolean {
    return true;
  }

  parseWebhook(body: unknown): NormalizedWebhookEvent {
    // Real-shaped payloads (what scripts/simulate-whatsapp.mjs sends, and what
    // 360dialog would send) go through the exact same parser the live provider
    // uses — otherwise the simulator would be testing a code path that does
    // not exist in production.
    if (body && typeof body === 'object' && 'entry' in body) {
      return parseCloudApiWebhook(body);
    }

    // Also accept the already-normalised shape, which is convenient in tests.
    const payload = body as Partial<NormalizedWebhookEvent> | undefined;
    return {
      messages: (payload?.messages ?? []).map((m) => ({
        ...m,
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        attachments: m.attachments ?? [],
        raw: m.raw ?? m,
      })),
      statuses: (payload?.statuses ?? []).map((s) => ({
        ...s,
        timestamp: s.timestamp ? new Date(s.timestamp) : new Date(),
        raw: s.raw ?? s,
      })),
    };
  }

  private record(to: string, kind: string, body: string): SendResult {
    this.outbox.push({ to, kind, body, at: new Date() });
    logger.info({ to: maskPhone(to), kind, preview: body.slice(0, 80) }, 'Mock WhatsApp send');
    return { externalId: `mock-${randomUUID()}`, status: 'accepted' };
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    return this.record(input.to, 'text', input.text);
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.record(
      input.to,
      'template',
      `${input.templateName}(${(input.variables ?? []).join(', ')})`,
    );
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    return this.record(input.to, 'media', input.filename ?? input.mediaUrl ?? input.mimeType);
  }

  async downloadMedia(mediaId: string): Promise<MediaDownload> {
    // A 1x1 transparent PNG, so the document pipeline has real bytes to store.
    const body = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    logger.info({ mediaId }, 'Mock media download');
    return { body, mimeType: 'image/png', filename: `${mediaId}.png`, sizeBytes: body.length };
  }

  async markAsRead(): Promise<void> {}
}
