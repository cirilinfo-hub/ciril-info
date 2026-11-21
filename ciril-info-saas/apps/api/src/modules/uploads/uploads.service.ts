import { randomUUID } from 'node:crypto';
import { Inject, Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage.js';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
/** Stored as "/uploads/images/<uuid>.<ext>" and turned into a full address when served to the website. */
export const UPLOAD_PATH = /^\/uploads\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;
export const UPLOAD_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Decides the real type from the file's first bytes, never from the name or the browser's claim. SVG is not accepted. */
export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Image uploads, on the server's disk or in S3 (STORAGE_DRIVER). Files get a random name; the original name is never used. */
@Injectable()
export class UploadsService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async saveImage(buf: Buffer | undefined): Promise<{ path: string; bytes: number }> {
    if (!buf?.length) throw new UnsupportedMediaTypeException({ code: 'NO_FILE', message: 'Choose an image to upload.' });
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'The image is larger than 3 MB. Choose a smaller one.' });
    }
    const ext = sniffImage(buf);
    if (!ext) {
      throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_IMAGE', message: 'Upload a PNG, JPEG or WebP image.' });
    }
    const name = `${randomUUID()}.${ext}`;
    await this.storage.put(`images/${name}`, buf, IMAGE_MIME[ext]!);
    return { path: `/uploads/images/${name}`, bytes: buf.length };
  }

  /** Deletes an uploaded file. Anything that is not exactly one of our upload paths is ignored. */
  async remove(ref: string | null | undefined): Promise<void> {
    if (!ref || !UPLOAD_PATH.test(ref)) return;
    await this.storage.delete(`images/${ref.split('/').pop()!}`);
  }

  /** An uploaded image for serving, or null. Only names this service generates are accepted. */
  async open(file: string) {
    if (!UPLOAD_FILE.test(file)) return null;
    return this.storage.get(`images/${file}`);
  }
}
