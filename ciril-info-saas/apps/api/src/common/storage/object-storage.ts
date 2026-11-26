import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Where uploaded files live. Keys are paths we generate ourselves ("images/<uuid>.png", "tickets/<tenant>/<uuid>"),
 * never anything a user typed, and each caller checks a key's shape before using it.
 */
export interface ObjectStorage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The file's bytes as a stream, or null if there is no such file. */
  get(key: string): Promise<Readable | null>;
  /** Deleting a file that does not exist is not an error. */
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const SAFE_KEY = /^[a-z]+(\/[A-Za-z0-9._-]+)+$/;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.split('/').some((p) => p === '..' || p === '.')) throw new Error(`Refused storage key "${key}".`);
}

/** Files on the server's own disk, under STORAGE_LOCAL_DIR. The disk must be backed up. */
export class LocalStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  readonly root: string;

  constructor(dir: string) {
    this.root = resolve(process.cwd(), dir);
  }

  private path(key: string) {
    checkKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error(`Refused storage key "${key}".`);
    return p;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx' }); // never overwrite: keys are random, a clash is a bug
  }

  async get(key: string): Promise<Readable | null> {
    const p = this.path(key);
    try {
      if (!(await stat(p)).isFile()) return null;
    } catch {
      return null;
    }
    return createReadStream(p);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

export interface S3Settings {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** For S3-compatible stores (Cloudflare R2, Backblaze B2, Wasabi, MinIO). Empty for Amazon S3. */
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Put everything under this folder in the bucket, e.g. "cirilinfo/". */
  prefix?: string;
}

/**
 * Amazon S3 or an S3-compatible store. The bucket stays private: files are never linked to directly, every download
 * goes through our API, which checks who is asking (ticket files) or serves public images itself.
 */
export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(private readonly s: S3Settings) {
    this.client = new S3Client({
      region: s.region,
      credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      ...(s.endpoint ? { endpoint: s.endpoint } : {}),
      forcePathStyle: s.forcePathStyle ?? false,
      // Extra checksums only when S3 requires them: several S3-compatible stores (R2, B2) reject the newer default ones.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const p = (s.prefix ?? '').replace(/^\/+|\/+$/g, '');
    this.prefix = p ? `${p}/` : '';
  }

  private key(key: string) {
    checkKey(key);
    return `${this.prefix}${key}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.s.bucket, Key: this.key(key), Body: body, ContentType: contentType, ContentLength: body.length }));
  }

  async get(key: string): Promise<Readable | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.s.bucket, Key: this.key(key) }));
      return (r.Body as Readable | undefined) ?? null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.s.bucket, Key: this.key(key) }));
  }

  destroy() {
    this.client.destroy();
  }
}
