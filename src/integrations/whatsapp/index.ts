import '@/lib/server-guard';
import { env } from '@/lib/env';
import { Dialog360Provider } from './360dialog';
import { MockWhatsAppProvider } from './mock';
import type { WhatsAppProvider } from './types';

export * from './types';

let instance: WhatsAppProvider | null = null;

/**
 * The only way the rest of the app gets a WhatsApp provider.
 *
 * Replacing 360dialog with Meta Cloud API, Twilio, or an aggregator means
 * writing one class that implements `WhatsAppProvider` and adding a case here.
 * Nothing in core/, app/ or ui/ needs to change.
 */
export function getWhatsApp(): WhatsAppProvider {
  if (!instance) {
    instance = env.WHATSAPP_PROVIDER === '360dialog' ? new Dialog360Provider() : new MockWhatsAppProvider();
  }
  return instance;
}

export function __setWhatsApp(provider: WhatsAppProvider | null) {
  instance = provider;
}
