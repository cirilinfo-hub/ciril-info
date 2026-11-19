import { sniffImage } from '../uploads/uploads.service.js';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_ATTACHMENTS_PER_TICKET = 20;

export interface AttachmentKind {
  contentType: string;
  /** Extension used when the original name has a missing or misleading one. */
  ext: string;
}

const IMAGE: Record<'png' | 'jpg' | 'webp', AttachmentKind> = {
  png: { contentType: 'image/png', ext: 'png' },
  jpg: { contentType: 'image/jpeg', ext: 'jpg' },
  webp: { contentType: 'image/webp', ext: 'webp' },
};
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv']);

/**
 * Decides what a file really is from its first bytes, never from its name or the browser's claim.
 * Accepted: PNG, JPEG, WebP, PDF and plain text (.txt, .log, .csv). Archives, documents with macros, scripts,
 * executables, SVG and HTML are refused: customers need to show a problem, not send software.
 */
export function sniffAttachment(buf: Buffer, originalName: string): AttachmentKind | null {
  const image = sniffImage(buf);
  if (image) return IMAGE[image];
  if (buf.length > 5 && buf.toString('latin1', 0, 5) === '%PDF-') return { contentType: 'application/pdf', ext: 'pdf' };
  const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : '';
  if (TEXT_EXTENSIONS.has(ext) && isPlainText(buf)) return { contentType: 'text/plain', ext };
  return null;
}

/** Valid UTF-8 with no NUL bytes: a real text file, not a binary renamed to .txt. */
export function isPlainText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** A file name that is safe to store and to put in a download header: no path, no control characters or quotes. */
export function safeFileName(original: string, kind: AttachmentKind): string {
  // Browsers may send the full client path; keep only the last part.
  const base = (original.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/^\.+/, '').trim().slice(0, 100) || 'file';
  return `${stem}.${kind.ext}`;
}

/** A Content-Disposition value that forces a download and survives non-ASCII names. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
