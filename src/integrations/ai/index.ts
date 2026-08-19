import '@/lib/server-guard';
import { env } from '@/lib/env';
import { MockAiProvider } from './mock';
import { OpenAiProvider } from './openai';
import type { AiProvider } from './types';

export * from './types';
export * from './vocabulary';

let instance: AiProvider | null = null;

/**
 * The only way the rest of the app gets an AI provider.
 * Changing model vendor = adding one class and one case here.
 */
export function getAi(): AiProvider {
  if (!instance) {
    instance = env.AI_PROVIDER === 'openai' ? new OpenAiProvider() : new MockAiProvider();
  }
  return instance;
}

export function __setAi(provider: AiProvider | null) {
  instance = provider;
}
