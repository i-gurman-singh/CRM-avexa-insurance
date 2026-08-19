/**
 * WhatsApp provider abstraction.
 *
 * The rest of the CRM only ever sees these normalised shapes. Replacing
 * 360dialog with Twilio, Meta Cloud API or anything else means writing one new
 * class that implements `WhatsAppProvider` — no changes to messaging, AI,
 * workflows or UI.
 */

export type NormalizedMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'contact'
  | 'sticker'
  | 'template'
  | 'system'
  | 'unknown';

export interface NormalizedAttachment {
  /** Provider media id used to fetch the binary later. */
  externalMediaId?: string;
  mimeType?: string;
  filename?: string;
  sizeBytes?: number;
  caption?: string;
  /** Voice notes: seconds. */
  durationSeconds?: number;
}

export interface NormalizedInboundMessage {
  /** Provider message id — our webhook dedupe key. */
  externalId: string;
  /** Sender's phone in E.164. */
  from: string;
  /** Our number that received it; supports multiple inboxes later. */
  to?: string;
  type: NormalizedMessageType;
  text?: string;
  attachments: NormalizedAttachment[];
  timestamp: Date;
  /** Display name from the WhatsApp profile, when the provider sends it. */
  profileName?: string;
  /** Untouched provider payload — persisted before any processing. */
  raw: unknown;
}

export type NormalizedStatusValue = 'sent' | 'delivered' | 'read' | 'failed';

export interface NormalizedStatusUpdate {
  externalId: string;
  status: NormalizedStatusValue;
  timestamp: Date;
  recipient?: string;
  errorMessage?: string;
  raw: unknown;
}

export interface NormalizedWebhookEvent {
  messages: NormalizedInboundMessage[];
  statuses: NormalizedStatusUpdate[];
}

export interface SendTextInput {
  to: string;
  text: string;
  /** Reply-to a specific message where the provider supports it. */
  replyToExternalId?: string;
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  languageCode?: string;
  /** Positional body variables. */
  variables?: string[];
}

export interface SendMediaInput {
  to: string;
  mediaUrl?: string;
  mediaBuffer?: Buffer;
  mimeType: string;
  filename?: string;
  caption?: string;
}

export interface SendResult {
  externalId: string;
  status: 'accepted';
}

export interface MediaDownload {
  body: Buffer;
  mimeType: string;
  filename?: string;
  sizeBytes: number;
}

export interface WhatsAppProvider {
  readonly name: string;

  /** Turn a raw webhook body into our normalised shape. Must never throw on
   *  unknown payloads — return empty arrays instead, so we still 200 the call. */
  parseWebhook(body: unknown, headers: Record<string, string>): NormalizedWebhookEvent;

  /** Optional signature/token verification. */
  verifyWebhook(body: string, headers: Record<string, string>): boolean;

  sendText(input: SendTextInput): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;
  downloadMedia(mediaId: string): Promise<MediaDownload>;
  markAsRead(externalId: string): Promise<void>;
}
