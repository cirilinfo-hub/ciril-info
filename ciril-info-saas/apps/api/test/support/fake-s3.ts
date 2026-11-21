import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

/**
 * A stand-in for an S3 bucket (path-style: /<bucket>/<key>). It keeps objects in memory, refuses requests that are not
 * signed with the expected access key, and can be told to fail, so tests see exactly what would reach the bucket.
 */
export class FakeS3 {
  server!: Server;
  objects = new Map<string, { body: Buffer; contentType: string | undefined }>();
  requests: { method: string; key: string }[] = [];
  /** Answer the next PUTs with a server error. */
  failPuts = 0;

  constructor(private readonly bucket: string, private readonly accessKeyId: string, private readonly port: number) {}

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(this.port, '127.0.0.1', r));
  }
  stop() {
    this.server.close();
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const xml = (status: number, code: string) => {
      res.writeHead(status, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
    };
    const authz = String(req.headers.authorization ?? '');
    if (!authz.startsWith(`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/`)) return xml(403, 'InvalidAccessKeyId');
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const prefix = `/${this.bucket}/`;
    if (!path.startsWith(prefix)) return xml(404, 'NoSuchBucket');
    const key = path.slice(prefix.length);
    const method = req.method ?? 'GET';
    this.requests.push({ method, key });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);

    if (method === 'PUT') {
      if (this.failPuts > 0) {
        this.failPuts--;
        return xml(503, 'SlowDown');
      }
      this.objects.set(key, { body: Buffer.concat(chunks), contentType: req.headers['content-type'] });
      res.writeHead(200, { etag: '"x"' });
      return res.end();
    }
    if (method === 'GET') {
      const o = this.objects.get(key);
      if (!o) return xml(404, 'NoSuchKey');
      res.writeHead(200, { 'content-type': o.contentType ?? 'application/octet-stream', 'content-length': o.body.length });
      return res.end(o.body);
    }
    if (method === 'DELETE') {
      this.objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    return xml(405, 'MethodNotAllowed');
  }
}
