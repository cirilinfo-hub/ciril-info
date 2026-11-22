import { type Server, type Socket, createServer } from 'node:net';

/**
 * A stand-in for a ClamAV daemon that speaks the INSTREAM protocol: it reassembles the length-prefixed chunks and calls a
 * file infected when it contains the EICAR test string (the standard harmless "test virus").
 */
export class FakeClamd {
  server!: Server;
  /** Every file it was asked about, reassembled from the chunks. */
  received: Buffer[] = [];
  /** Answer this instead of scanning (for testing odd replies). */
  reply: string | null = null;
  /** Accept the connection but never answer. */
  hang = false;

  constructor(private readonly port: number) {}

  async start() {
    this.server = createServer((s) => this.handle(s));
    await new Promise<void>((r) => this.server.listen(this.port, '127.0.0.1', r));
  }
  async stop() {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private handle(socket: Socket) {
    let buf = Buffer.alloc(0);
    let commandRead = false;
    const parts: Buffer[] = [];
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!commandRead) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        if (buf.subarray(0, end).toString() !== 'zINSTREAM') {
          socket.end('UNKNOWN COMMAND\0');
          return;
        }
        buf = buf.subarray(end + 1);
        commandRead = true;
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const file = Buffer.concat(parts);
          this.received.push(file);
          if (this.hang) return;
          const answer = this.reply ?? (file.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK');
          socket.end(`${answer}\0`);
          return;
        }
        if (buf.length < 4 + len) return;
        parts.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
    socket.on('error', () => undefined);
  }
}

/** The EICAR test string: every antivirus flags it, and it is harmless. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
