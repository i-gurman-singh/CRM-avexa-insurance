import '@/lib/server-guard';
import { env } from '@/lib/env';
import { LocalStorageProvider } from './local';
import { S3StorageProvider } from './s3';
import type { StorageProvider } from './types';

export * from './types';

let instance: StorageProvider | null = null;

/**
 * The only way the rest of the app gets a storage provider.
 * Swapping S3 for another object store means adding one file here.
 */
export function getStorage(): StorageProvider {
  if (!instance) {
    instance = env.STORAGE_PROVIDER === 's3' ? new S3StorageProvider() : new LocalStorageProvider();
  }
  return instance;
}

/** Test hook. */
export function __setStorage(provider: StorageProvider | null) {
  instance = provider;
}
