/**
 * Simulate an inbound WhatsApp message.
 *
 *   node scripts/simulate-whatsapp.mjs "+14165550199" "Hi, I need car insurance"
 *   node scripts/simulate-whatsapp.mjs "+14165550199" --image
 *   node scripts/simulate-whatsapp.mjs "+14165550199" --image "here's my licence"
 *   node scripts/simulate-whatsapp.mjs "+14165550199" --document ownership.pdf
 *
 * Posts a payload in 360dialog's shape to the local webhook, so the whole
 * inbound path — dedupe, lead creation, storage, AI understanding, workflow
 * rules, document requests — can be exercised without a live WABA number.
 *
 * Requires the app to be running and WHATSAPP_WEBHOOK_TOKEN to match .env.
 */
import { randomUUID } from 'node:crypto';

const [, , rawPhone, ...rest] = process.argv;

if (!rawPhone) {
  console.error('Usage: node scripts/simulate-whatsapp.mjs <phone> <message | --image name.jpg>');
  process.exit(1);
}

const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
const token = process.env.WHATSAPP_WEBHOOK_TOKEN ?? 'dev-token';
const phone = rawPhone.replace(/^\+/, '');

const isImage = rest[0] === '--image';
const isDocument = rest[0] === '--document';
const text = rest.join(' ');
const messageId = `wamid.sim.${randomUUID()}`;
const timestamp = Math.floor(Date.now() / 1000);

let message;
if (isImage) {
  message = {
    id: messageId,
    from: phone,
    timestamp: String(timestamp),
    type: 'image',
    // Caption is optional — a bare photo with no text is the common case, and
    // it is worth being able to simulate exactly that.
    image: {
      id: `media.${randomUUID()}`,
      mime_type: 'image/jpeg',
      ...(rest.length > 1 ? { caption: rest.slice(1).join(' ') } : {}),
    },
  };
} else if (isDocument) {
  message = {
    id: messageId,
    from: phone,
    timestamp: String(timestamp),
    type: 'document',
    document: {
      id: `media.${randomUUID()}`,
      mime_type: 'application/pdf',
      filename: rest[1] ?? 'document.pdf',
    },
  };
} else {
  message = {
    id: messageId,
    from: phone,
    timestamp: String(timestamp),
    type: 'text',
    text: { body: text || 'Hello' },
  };
}

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'simulated',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '14165551000', phone_number_id: 'simulated' },
            contacts: [{ profile: { name: 'Simulated Client' }, wa_id: phone }],
            messages: [message],
          },
        },
      ],
    },
  ],
};

const response = await fetch(`${appUrl}/api/webhooks/whatsapp?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const body = await response.text();
console.log(`${response.status} ${body}`);
if (!response.ok) process.exit(1);
