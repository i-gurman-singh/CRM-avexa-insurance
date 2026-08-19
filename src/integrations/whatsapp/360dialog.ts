import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { IntegrationError } from '@/lib/errors';
import { log } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils';
import type {
  MediaDownload,
  NormalizedAttachment,
  NormalizedInboundMessage,
  NormalizedMessageType,
  NormalizedStatusUpdate,
  NormalizedWebhookEvent,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppProvider,
} from './types';

const logger = log('whatsapp:360dialog');

/**
 * 360dialog Cloud API (WABA v2).
 *
 * Docs: https://docs.360dialog.com/
 * Auth is a single `D360-API-KEY` header. The payload shape mirrors Meta's
 * Cloud API webhook, so this adapter also works for direct Meta integration
 * with only the base URL and auth header changed.
 */
export class Dialog360Provider implements WhatsAppProvider {
  readonly name = '360dialog';
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    if (!env.DIALOG360_API_KEY) throw new Error('DIALOG360_API_KEY is required');
    this.apiKey = env.DIALOG360_API_KEY;
    this.baseUrl = env.DIALOG360_BASE_URL.replace(/\/$/, '');
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  verifyWebhook(body: string, headers: Record<string, string>): boolean {
    // If no signing secret is configured we rely on the URL token, which the
    // route checks before calling us.
    if (!env.WHATSAPP_WEBHOOK_SECRET) return true;

    const provided = headers['x-hub-signature-256'] ?? headers['x-360dialog-signature'] ?? '';
    if (!provided) return false;

    const expected = `sha256=${createHmac('sha256', env.WHATSAPP_WEBHOOK_SECRET).update(body).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): NormalizedWebhookEvent {
    return parseCloudApiWebhook(body);
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'D360-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 4xx (other than 429) means the request itself is wrong — don't retry.
      const retryable = res.status === 429 || res.status >= 500;
      logger.error({ status: res.status, detail: detail.slice(0, 500), path }, '360dialog API error');
      throw new IntegrationError('360dialog', `API returned ${res.status}`, {
        retryable,
        details: detail.slice(0, 500),
      });
    }

    return (await res.json()) as T;
  }

  private toWaId(phone: string): string {
    // WhatsApp expects the number without the leading '+'.
    return phone.replace(/^\+/, '');
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const res = await this.request<any>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: this.toWaId(input.to),
        type: 'text',
        text: { body: input.text, preview_url: false },
        ...(input.replyToExternalId ? { context: { message_id: input.replyToExternalId } } : {}),
      }),
    });
    return { externalId: res?.messages?.[0]?.id ?? '', status: 'accepted' };
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const res = await this.request<any>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: this.toWaId(input.to),
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: input.languageCode ?? 'en' },
          components: input.variables?.length
            ? [
                {
                  type: 'body',
                  parameters: input.variables.map((v) => ({ type: 'text', text: v })),
                },
              ]
            : undefined,
        },
      }),
    });
    return { externalId: res?.messages?.[0]?.id ?? '', status: 'accepted' };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    let mediaId: string | undefined;

    if (input.mediaBuffer) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append(
        'file',
        new Blob([new Uint8Array(input.mediaBuffer)], { type: input.mimeType }),
        input.filename ?? 'file',
      );
      const uploadRes = await fetch(`${this.baseUrl}/media`, {
        method: 'POST',
        headers: { 'D360-API-KEY': this.apiKey },
        body: form,
      });
      if (!uploadRes.ok) {
        throw new IntegrationError('360dialog', `Media upload failed (${uploadRes.status})`);
      }
      mediaId = ((await uploadRes.json()) as any)?.id;
    }

    const kind = input.mimeType.startsWith('image/') ? 'image' : 'document';
    const media: Record<string, unknown> = mediaId ? { id: mediaId } : { link: input.mediaUrl };
    if (input.caption) media.caption = input.caption;
    if (kind === 'document' && input.filename) media.filename = input.filename;

    const res = await this.request<any>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: this.toWaId(input.to),
        type: kind,
        [kind]: media,
      }),
    });
    return { externalId: res?.messages?.[0]?.id ?? '', status: 'accepted' };
  }

  async downloadMedia(mediaId: string): Promise<MediaDownload> {
    // Two-step: resolve the media id to a URL, then fetch the bytes with auth.
    const meta = await this.request<any>(`/${mediaId}`, { method: 'GET' });
    const url: string | undefined = meta?.url;
    if (!url) throw new IntegrationError('360dialog', 'Media URL missing in response');

    const res = await fetch(url, { headers: { 'D360-API-KEY': this.apiKey } });
    if (!res.ok) {
      throw new IntegrationError('360dialog', `Media download failed (${res.status})`, {
        retryable: res.status >= 500 || res.status === 429,
      });
    }

    const body = Buffer.from(await res.arrayBuffer());
    return {
      body,
      mimeType: meta?.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream',
      filename: meta?.file_name,
      sizeBytes: body.length,
    };
  }

  async markAsRead(externalId: string): Promise<void> {
    try {
      await this.request('/messages', {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: externalId,
        }),
      });
    } catch (e) {
      // Read receipts are cosmetic — never fail the caller over one.
      logger.warn({ err: e, externalId }, 'markAsRead failed');
    }
  }
}


// ---------------------------------------------------------------------------
// Webhook parsing
//
// Exported separately from the class so it can be reused without credentials —
// the offline provider parses the same payload shape, which means the webhook
// simulator exercises the real production path rather than a shortcut.
// ---------------------------------------------------------------------------

export function parseCloudApiWebhook(body: unknown): NormalizedWebhookEvent {
  const messages: NormalizedInboundMessage[] = [];
  const statuses: NormalizedStatusUpdate[] = [];

  try {
    const payload = body as any;
    const entries = payload?.entry ?? [];

    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const contacts: any[] = value.contacts ?? [];
        const businessNumber = value.metadata?.display_phone_number;

        for (const m of value.messages ?? []) {
          const contact = contacts.find((c) => c.wa_id === m.from);
          messages.push(normalizeMessage(m, contact, businessNumber));
        }

        for (const s of value.statuses ?? []) {
          statuses.push({
            externalId: s.id,
            status: normalizeStatus(s.status),
            timestamp: toDate(s.timestamp),
            recipient: normalizePhone(s.recipient_id) ?? undefined,
            errorMessage: s.errors?.[0]?.title ?? s.errors?.[0]?.message,
            raw: s,
          });
        }
      }
    }
  } catch (e) {
    // Never throw here — an unparseable payload must still be acknowledged so
    // the provider does not hammer us with retries. The raw body is persisted
    // by the route regardless, so nothing is lost.
    logger.error({ err: e }, 'Failed to parse WhatsApp webhook payload');
  }

  return { messages, statuses };
}

function normalizeMessage(m: any, contact: any, businessNumber?: string): NormalizedInboundMessage {
  const type = normalizeType(m.type);
  const attachments: NormalizedAttachment[] = [];
  let text: string | undefined;

  switch (m.type) {
      case 'text':
        text = m.text?.body;
        break;
      case 'image':
        attachments.push({
          externalMediaId: m.image?.id,
          mimeType: m.image?.mime_type,
          caption: m.image?.caption,
        });
        text = m.image?.caption;
        break;
      case 'document':
        attachments.push({
          externalMediaId: m.document?.id,
          mimeType: m.document?.mime_type,
          filename: m.document?.filename,
          caption: m.document?.caption,
        });
        text = m.document?.caption;
        break;
      case 'audio':
      case 'voice':
        attachments.push({
          externalMediaId: m.audio?.id ?? m.voice?.id,
          mimeType: m.audio?.mime_type ?? m.voice?.mime_type,
          // 360dialog does not always send duration; we store what we get.
          durationSeconds: m.audio?.duration ?? m.voice?.duration,
        });
        break;
      case 'video':
        attachments.push({
          externalMediaId: m.video?.id,
          mimeType: m.video?.mime_type,
          caption: m.video?.caption,
        });
        text = m.video?.caption;
        break;
      case 'sticker':
        attachments.push({ externalMediaId: m.sticker?.id, mimeType: m.sticker?.mime_type });
        break;
      case 'location':
        text = [m.location?.name, m.location?.address].filter(Boolean).join(', ') || 'Shared a location';
        break;
      case 'contacts':
        text = 'Shared a contact card';
        break;
      case 'button':
        text = m.button?.text;
        break;
      case 'interactive':
        text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
        break;
      default:
        break;
  }

  return {
      externalId: m.id,
      from: normalizePhone(m.from) ?? m.from,
      to: businessNumber ? (normalizePhone(businessNumber) ?? businessNumber) : undefined,
      type,
      text,
      attachments,
      timestamp: toDate(m.timestamp),
      profileName: contact?.profile?.name,
      raw: m,
  };
}

function normalizeType(t: string): NormalizedMessageType {
  switch (t) {
      case 'text':
      case 'button':
      case 'interactive':
        return 'text';
      case 'image':
        return 'image';
      case 'document':
        return 'document';
      case 'audio':
      case 'voice':
        return 'audio';
      case 'video':
        return 'video';
      case 'location':
        return 'location';
      case 'contacts':
        return 'contact';
      case 'sticker':
        return 'sticker';
      case 'template':
        return 'template';
      case 'system':
        return 'system';
      default:
        return 'unknown';
  }
}

function normalizeStatus(s: string): NormalizedStatusUpdate['status'] {
  if (s === 'delivered') return 'delivered';
  if (s === 'read') return 'read';
  if (s === 'failed') return 'failed';
  return 'sent';
}

function toDate(ts: string | number | undefined): Date {
  if (!ts) return new Date();
  const n = typeof ts === 'string' ? Number(ts) : ts;
  // WhatsApp sends unix seconds.
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
}
