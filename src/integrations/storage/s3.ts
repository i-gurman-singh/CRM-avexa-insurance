import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { IntegrationError, NotFoundError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { PutObjectInput, PutObjectResult, StorageProvider, StoredObject } from './types';

const logger = log('storage:s3');

/**
 * S3-backed storage. The bucket MUST be created with:
 *   - Block Public Access: all four settings ON
 *   - Default encryption: SSE-S3 (or SSE-KMS)
 *   - Versioning: enabled (protects against accidental overwrite/delete)
 * See docs/DEPLOYMENT.md for the exact bucket policy.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private client: S3Client;
  private bucket: string;

  constructor() {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required for the s3 storage provider');
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.AWS_REGION,
      // Omitting credentials lets the SDK use the Lightsail instance role,
      // which is preferable to long-lived keys in .env.
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    const sha256 = createHash('sha256').update(body).digest('hex');

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: body,
          ContentType: input.contentType,
          ServerSideEncryption: 'AES256',
          Metadata: { ...input.metadata, sha256 },
        }),
      );
    } catch (e) {
      logger.error({ err: e, key: input.key }, 'S3 put failed');
      throw new IntegrationError('s3', 'Failed to store object', { details: input.key });
    }

    return { key: input.key, sizeBytes: body.length, sha256 };
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = Buffer.from(await res.Body!.transformToByteArray());
      return {
        key,
        body,
        contentType: res.ContentType ?? 'application/octet-stream',
        sizeBytes: body.length,
      };
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
        throw new NotFoundError('Document');
      }
      logger.error({ err: e, key }, 'S3 get failed');
      throw new IntegrationError('s3', 'Failed to read object', { details: key });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      logger.error({ err: e, key }, 'S3 delete failed');
      throw new IntegrationError('s3', 'Failed to delete object', { details: key });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(
    key: string,
    opts: { ttlSeconds?: number; downloadFilename?: string } = {},
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.downloadFilename
        ? `attachment; filename="${opts.downloadFilename.replace(/"/g, '')}"`
        : undefined,
    });
    return presign(this.client, command, { expiresIn: opts.ttlSeconds ?? env.S3_SIGNED_URL_TTL });
  }
}
