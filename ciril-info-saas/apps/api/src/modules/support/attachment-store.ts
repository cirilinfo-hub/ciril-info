import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE, safeFileName, sniffAttachment } from './attachments.js';

/** What the upload middleware hands us for each file. */
export interface UploadedFileLike {
  originalname: string;
  buffer?: Buffer;
  size?: number;
}

export interface PreparedFile {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  buffer: Buffer;
}

export interface StoredFile extends Omit<PreparedFile, 'buffer'> {
  storageKey: string;
}

const KEY = /^tickets\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/**
 * Private files for support tickets, on local disk (STORAGE_DRIVER=local). Nothing here is served statically:
 * every download goes through an authenticated endpoint that re-checks the ticket. Files get random names, the
 * original name only lives in the database. There is no virus scanner, so only a few harmless types are accepted
 * and every download is sent as an attachment with `nosniff`.
 */
@Injectable()
export class AttachmentStore {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(process.cwd(), config.get('STORAGE_LOCAL_DIR', { infer: true }));
    if (config.get('STORAGE_DRIVER', { infer: true }) !== 'local') {
      // The S3 driver is part of the hosting work. Refuse loudly rather than silently writing to a disk that is not backed up.
      throw new Error('Ticket attachments need STORAGE_DRIVER=local until the S3 driver is built.');
    }
  }

  /** Checks every file before anything is written, so a bad one rejects the whole message. */
  prepare(files: readonly UploadedFileLike[] | undefined): PreparedFile[] {
    const list = files ?? [];
    if (list.length > MAX_FILES_PER_MESSAGE) {
      throw new UnsupportedMediaTypeException({ code: 'TOO_MANY_FILES', message: `Attach at most ${MAX_FILES_PER_MESSAGE} files to one message.` });
    }
    return list.map((f) => {
      const name = f.originalname || 'file';
      const buf = f.buffer;
      if (!buf || buf.length === 0) {
        throw new UnsupportedMediaTypeException({ code: 'EMPTY_FILE', message: `"${name}" is empty.` });
      }
      if (buf!.length > MAX_ATTACHMENT_BYTES) {
        throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: `"${name}" is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` });
      }
      const kind = sniffAttachment(buf!, name);
      if (!kind) {
        throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_FILE', message: `"${name}" is not a supported file. Attach a PNG, JPEG or WebP image, a PDF, or a .txt, .log or .csv file.` });
      }
      return { fileName: safeFileName(name, kind), contentType: kind.contentType, sizeBytes: buf!.length, sha256: createHash('sha256').update(buf!).digest('hex'), buffer: buf! };
    });
  }

  async saveAll(tenantId: string, files: readonly PreparedFile[]): Promise<StoredFile[]> {
    const saved: StoredFile[] = [];
    try {
      for (const f of files) {
        const id = randomUUID();
        const dir = join(this.root, 'tickets', tenantId);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, id), f.buffer, { flag: 'wx' });
        const { buffer: _buffer, ...meta } = f;
        saved.push({ ...meta, storageKey: `tickets/${tenantId}/${id}` });
      }
      return saved;
    } catch (e) {
      await this.removeAll(saved.map((s) => s.storageKey));
      throw e;
    }
  }

  async removeAll(keys: readonly string[]) {
    await Promise.all(keys.filter((k) => KEY.test(k)).map((k) => rm(join(this.root, k), { force: true })));
  }

  /** Opens a stored file for download. Only keys this store wrote are accepted. */
  async open(key: string) {
    if (!KEY.test(key)) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
    const path = join(this.root, key);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
    }
    return createReadStream(path);
  }
}
