import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage.js';
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
 * Private files for support tickets, on the server's disk or in a private S3 bucket (STORAGE_DRIVER). Nothing here is served statically:
 * every download goes through an authenticated endpoint that re-checks the ticket. Files get random names, the
 * original name only lives in the database. There is no virus scanner, so only a few harmless types are accepted
 * and every download is sent as an attachment with `nosniff`.
 */
@Injectable()
export class AttachmentStore {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

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
        const key = `tickets/${tenantId}/${randomUUID()}`;
        await this.storage.put(key, f.buffer, f.contentType);
        const { buffer: _buffer, ...meta } = f;
        saved.push({ ...meta, storageKey: key });
      }
      return saved;
    } catch (e) {
      await this.removeAll(saved.map((s) => s.storageKey));
      throw e;
    }
  }

  async removeAll(keys: readonly string[]) {
    await Promise.all(keys.filter((k) => KEY.test(k)).map((k) => this.storage.delete(k).catch(() => undefined)));
  }

  /** Opens a stored file for download. Only keys this store wrote are accepted. */
  async open(key: string) {
    if (!KEY.test(key)) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
    const stream = await this.storage.get(key);
    if (!stream) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
    return stream;
  }
}
