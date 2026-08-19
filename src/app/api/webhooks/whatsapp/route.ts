import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { clientIp, handler, rateLimit } from '@/lib/api';
import { getWhatsApp } from '@/integrations/whatsapp';
import { ingestWebhookEvent } from '@/core/messaging/inbound';

const logger = log('webhook:whatsapp');

/**
 * Inbound WhatsApp webhook.
 *
 * Contract with the provider: acknowledge fast, always. This handler does the
 * minimum — verify, parse, persist — and hands everything expensive to the
 * queue. Even a total failure downstream returns 200, because a non-200 makes
 * 360dialog retry, and a retry storm on top of a broken deploy is strictly
 * worse than a message we can replay from the WebhookEvent table.
 *
 * Configure the provider to POST to:
 *   https://crm.yourdomain.com/api/webhooks/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(async (request: Request) => {
  const ip = clientIp(request);

  // Generous, but enough to stop a runaway retry loop from flooding Postgres.
  const limit = rateLimit(`webhook:${ip}`, { limit: 600, windowMs: 60_000 });
  if (!limit.allowed) {
    logger.warn({ ip }, 'Webhook rate limit exceeded');
    return NextResponse.json({ ok: true, throttled: true }, { status: 200 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token || token !== env.WHATSAPP_WEBHOOK_TOKEN) {
    logger.warn({ ip }, 'Webhook rejected: bad token');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rawBody = await request.text();

  const headerMap: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headerMap[key.toLowerCase()] = value;
  });

  const provider = getWhatsApp();

  if (!provider.verifyWebhook(rawBody, headerMap)) {
    logger.warn({ ip }, 'Webhook rejected: bad signature');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.warn({ ip, preview: rawBody.slice(0, 200) }, 'Webhook body was not JSON');
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  try {
    const event = provider.parseWebhook(payload, headerMap);

    if (!event.messages.length && !event.statuses.length) {
      return NextResponse.json({ ok: true, empty: true }, { status: 200 });
    }

    const result = await ingestWebhookEvent(provider.name, event, payload);

    logger.info(result, 'Webhook processed');
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    // Keep the raw payload so nothing is lost and the event can be replayed.
    logger.error({ err: e }, 'Webhook ingestion failed; storing raw payload for replay');
    await db.webhookEvent
      .create({
        data: {
          provider: provider.name,
          externalId: `failed-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          eventType: 'error',
          payload: payload as object,
          error: e instanceof Error ? e.message.slice(0, 1000) : 'Unknown error',
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, deferred: true }, { status: 200 });
  }
});

/**
 * Verification handshake. Meta-style providers call GET with a challenge when
 * the webhook URL is first registered.
 */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (token !== env.WHATSAPP_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true, provider: getWhatsApp().name });
});
