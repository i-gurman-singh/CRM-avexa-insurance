import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Liveness/readiness probe for the load balancer and deployment scripts.
 * Reports which providers are wired up, which is the fastest way to spot a
 * deploy that came up with the wrong environment.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const started = Date.now();
  let database: 'ok' | 'error' = 'ok';
  let queueDepth: number | null = null;

  try {
    await db.$queryRaw`SELECT 1`;
    queueDepth = await db.job.count({ where: { status: 'QUEUED' } });
  } catch {
    database = 'error';
  }

  const body = {
    status: database === 'ok' ? ('ok' as const) : ('degraded' as const),
    database,
    queueDepth,
    providers: {
      whatsapp: env.WHATSAPP_PROVIDER,
      ai: env.AI_PROVIDER,
      storage: env.STORAGE_PROVIDER,
      queue: env.QUEUE_PROVIDER,
    },
    outboundAutomation: env.AUTOMATION_OUTBOUND_ENABLED,
    latencyMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: database === 'ok' ? 200 : 503 });
}
