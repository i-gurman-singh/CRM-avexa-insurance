/**
 * Storage abstraction.
 *
 * Client documents are highly sensitive: nothing here ever produces a public
 * URL. Reads happen either as a server-side buffer or via a short-lived signed
 * URL that the API generates per request, after a permission check.
 */

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  /** Extra metadata stored alongside the object (S3 user metadata). */
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly name: string;

  put(input: PutObjectInput): Promise<PutObjectResult>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;

  /**
   * Time-limited read URL. `ttlSeconds` defaults to the configured value.
   * Callers MUST have already authorised the request.
   */
  getSignedUrl(key: string, opts?: { ttlSeconds?: number; downloadFilename?: string }): Promise<string>;
}

/** Deterministic, non-guessable object keys, partitioned by client. */
export function buildDocumentKey(clientId: string, documentId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]/g, '_').slice(-120);
  return `clients/${clientId}/documents/${documentId}/${safe}`;
}
