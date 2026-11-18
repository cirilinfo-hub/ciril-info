import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

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

/** Image uploads on local disk (STORAGE_DRIVER=local). Files get a random name; the original name is never used. */
@Injectable()
export class UploadsService {
  readonly dir: string;

  constructor(config: ConfigService<Env, true>) {
    this.dir = resolve(process.cwd(), config.get('STORAGE_LOCAL_DIR', { infer: true }), 'images');
  }

  async saveImage(buf: Buffer | undefined): Promise<{ path: string; bytes: number }> {
    if (!buf?.length) throw new UnsupportedMediaTypeException({ code: 'NO_FILE', message: 'Choose an image to upload.' });
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'The image is larger than 3 MB. Choose a smaller one.' });
    }
    const ext = sniffImage(buf);
    if (!ext) {
      throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_IMAGE', message: 'Upload a PNG, JPEG or WebP image.' });
    }
    await mkdir(this.dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await writeFile(join(this.dir, name), buf, { flag: 'wx' });
    return { path: `/uploads/images/${name}`, bytes: buf.length };
  }

  /** Deletes an uploaded file. Anything that is not exactly one of our upload paths is ignored. */
  async remove(ref: string | null | undefined): Promise<void> {
    if (!ref || !UPLOAD_PATH.test(ref)) return;
    await rm(join(this.dir, ref.split('/').pop()!), { force: true });
  }
}
