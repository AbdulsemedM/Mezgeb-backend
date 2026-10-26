import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/env.schema.js';

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

/** Files (payment receipt photos) behind an interface (CLAUDE.md conventions). */
export abstract class ObjectStorage {
  abstract put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Null when there is no such object. */
  abstract get(key: string): Promise<StoredObject | null>;
}

/** S3 or MinIO (local: `pnpm db:up`, bucket from S3_BUCKET). */
export class S3ObjectStorage extends ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    super();
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // MinIO serves buckets by path, not as subdomains.
      forcePathStyle: true,
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return {
        bytes: await res.Body.transformToByteArray(),
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }
}

/** Tests and quick local runs: keeps objects in memory. */
export class MemoryObjectStorage extends ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }
}
