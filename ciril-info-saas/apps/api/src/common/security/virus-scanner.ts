import { connect } from 'node:net';
import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export class ScannerUnavailable extends Error {}

const CHUNK = 64 * 1024;

/**
 * Asks a clamd daemon (ClamAV) about one file over its INSTREAM command: the bytes are streamed in length-prefixed chunks
 * and clamd answers "stream: OK" or "stream: <signature> FOUND". Nothing is written to disk for this. Any other answer,
 * a refused connection or a timeout is ScannerUnavailable: the caller then refuses the file rather than keep it unchecked.
 */
export function clamdScan(host: string, port: number, body: Buffer, timeoutMs: number): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    socket.setTimeout(timeoutMs, () => done(() => reject(new ScannerUnavailable(`clamd did not answer within ${timeoutMs} ms`))));
    socket.on('error', (e) => done(() => reject(new ScannerUnavailable(`clamd could not be reached: ${e.message}`))));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      done(() => {
        if (/^stream: OK$/.test(reply)) return resolve({ clean: true });
        const found = /^stream: (.+) FOUND$/.exec(reply);
        if (found) return resolve({ clean: false, signature: found[1]! });
        reject(new ScannerUnavailable(`clamd answered "${reply.slice(0, 120)}"`));
      });
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < body.length; i += CHUNK) {
        const part = body.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
    });
  });
}

/** Virus scanning of uploaded files, switched on with VIRUS_SCAN=clamav. Off, every file counts as clean. */
@Injectable()
export class VirusScanner {
  private readonly log = new Logger(VirusScanner.name);
  readonly enabled: boolean;
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.enabled = config.get('VIRUS_SCAN', { infer: true }) === 'clamav';
    this.host = config.get('CLAMAV_HOST', { infer: true });
    this.port = config.get('CLAMAV_PORT', { infer: true });
    this.timeoutMs = config.get('CLAMAV_TIMEOUT_MS', { infer: true });
  }

  async scan(body: Buffer): Promise<ScanResult> {
    if (!this.enabled) return { clean: true };
    return clamdScan(this.host, this.port, body, this.timeoutMs);
  }

  /** Throws a customer-facing error for an infected file, or when files cannot be checked right now. */
  async assertClean(files: readonly { name: string; body: Buffer }[]): Promise<void> {
    if (!this.enabled) return;
    for (const f of files) {
      let r: ScanResult;
      try {
        r = await this.scan(f.body);
      } catch (e) {
        if (!(e instanceof ScannerUnavailable)) throw e;
        this.log.error(`virus scanner unavailable: ${e.message}`);
        throw new ServiceUnavailableException({ code: 'SCANNER_UNAVAILABLE', message: 'Files cannot be checked for viruses right now, so nothing was uploaded. Please try again in a few minutes.' });
      }
      if (!r.clean) {
        this.log.warn(`infected upload refused: ${r.signature}`);
        throw new UnprocessableEntityException({ code: 'FILE_INFECTED', message: `"${f.name}" looks like it contains a virus (${r.signature}), so it was not uploaded.`, details: { signature: r.signature } });
      }
    }
  }
}
