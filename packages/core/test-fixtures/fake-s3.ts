import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * An in-process S3-compatible server for tests: path-style addressing, PutObject, multipart upload (create, UploadPart, complete,
 * abort), GetObject, HeadObject, ListObjectsV2 (with paging) and DeleteObject. Requests are authenticated by access key only
 * (the signature is not verified). No real network is involved: it listens on 127.0.0.1.
 */
export interface FakeS3Options { bucket?: string; accessKeyId?: string; pageSize?: number }
export interface FakeS3 {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  /** Stored objects by key (the bucket is implied). */
  objects: Map<string, { body: Buffer; at: Date }>;
  /** Every request the server saw, in order. */
  log: Array<{ method: string; path: string; query: string; bytes: number; authorization: string }>;
  /** Number of multipart uploads that were completed. */
  multipartCompleted: number;
  /** Make the next `count` write requests (PUT, POST) fail with `status`. */
  failWrites(count: number, status?: number): void;
  /** Pretend this key was written long ago (to exercise retention). */
  put(key: string, body: string | Buffer, at?: Date): void;
  keys(prefix?: string): string[];
  close(): Promise<void>;
}

const xml = (s: string) => `<?xml version="1.0" encoding="UTF-8"?>${s}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md5 = (b: Buffer) => `"${createHash('md5').update(b).digest('hex')}"`;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeS3(o: FakeS3Options = {}): Promise<FakeS3> {
  const bucket = o.bucket ?? 'test-bucket';
  const accessKeyId = o.accessKeyId ?? 'AKIATESTKEY';
  const pageSize = o.pageSize ?? 1000;
  const objects: FakeS3['objects'] = new Map();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  let failing = { count: 0, status: 500 };
  const fake = { log: [] as FakeS3['log'], multipartCompleted: 0 };

  const send = (res: ServerResponse, status: number, body = '', headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/xml', ...headers }); res.end(body); };
  const error = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, xml(`<Error><Code>${code}</Code><Message>${esc(message)}</Message></Error>`));

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE' ? Buffer.alloc(0) : await readBody(req);
      const auth = String(req.headers.authorization ?? '');
      fake.log.push({ method: req.method ?? '', path: url.pathname, query: url.search, bytes: body.length, authorization: auth });
      if (!auth.includes(`Credential=${accessKeyId}/`)) return error(res, 403, 'InvalidAccessKeyId', 'The access key does not exist');
      const [, b, ...rest] = url.pathname.split('/');
      if (b !== bucket) return error(res, 404, 'NoSuchBucket', 'The specified bucket does not exist');
      const key = decodeURIComponent(rest.join('/'));
      const writes = req.method === 'PUT' || req.method === 'POST';
      if (writes && failing.count > 0) { failing.count--; return error(res, failing.status, 'InternalError', 'Injected failure'); }

      if (!key) { // bucket-level: ListObjectsV2
        if (req.method !== 'GET') return error(res, 405, 'MethodNotAllowed', 'Not supported');
        const prefix = url.searchParams.get('prefix') ?? '';
        const start = url.searchParams.get('continuation-token');
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const from = start ? all.findIndex((k) => k > Buffer.from(start, 'base64url').toString()) : 0;
        const page = from < 0 ? [] : all.slice(from, from + pageSize);
        const more = from >= 0 && from + pageSize < all.length;
        const items = page.map((k) => { const v = objects.get(k)!; return `<Contents><Key>${esc(k)}</Key><LastModified>${v.at.toISOString()}</LastModified><ETag>${md5(v.body)}</ETag><Size>${v.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`; }).join('');
        return send(res, 200, xml(`<ListBucketResult><Name>${bucket}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${Buffer.from(page[page.length - 1]!).toString('base64url')}</NextContinuationToken>` : ''}${items}</ListBucketResult>`));
      }

      const uploadId = url.searchParams.get('uploadId');
      if (req.method === 'POST' && url.searchParams.has('uploads')) {
        const id = randomUUID();
        uploads.set(id, { key, parts: new Map() });
        return send(res, 200, xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${esc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`));
      }
      if (req.method === 'PUT' && uploadId) {
        const u = uploads.get(uploadId);
        if (!u) return error(res, 404, 'NoSuchUpload', 'Unknown upload');
        u.parts.set(Number(url.searchParams.get('partNumber')), body);
        return send(res, 200, '', { etag: md5(body) });
      }
      if (req.method === 'POST' && uploadId) {
        const u = uploads.get(uploadId);
        if (!u) return error(res, 404, 'NoSuchUpload', 'Unknown upload');
        const numbers = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
        const data = Buffer.concat(numbers.map((n) => u.parts.get(n) ?? Buffer.alloc(0)));
        objects.set(key, { body: data, at: new Date() });
        uploads.delete(uploadId);
        fake.multipartCompleted++;
        return send(res, 200, xml(`<CompleteMultipartUploadResult><Location>x</Location><Bucket>${bucket}</Bucket><Key>${esc(key)}</Key><ETag>${md5(data)}</ETag></CompleteMultipartUploadResult>`));
      }
      if (req.method === 'DELETE' && uploadId) { uploads.delete(uploadId); return send(res, 204); }
      if (req.method === 'PUT') { objects.set(key, { body, at: new Date() }); return send(res, 200, '', { etag: md5(body) }); }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const v = objects.get(key);
        if (!v) return error(res, 404, 'NoSuchKey', 'The specified key does not exist');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': v.body.length, etag: md5(v.body), 'last-modified': v.at.toUTCString() });
        return res.end(req.method === 'HEAD' ? undefined : v.body);
      }
      if (req.method === 'DELETE') { objects.delete(key); return send(res, 204); }
      return error(res, 405, 'MethodNotAllowed', 'Not supported');
    })().catch((e) => { try { error(res, 500, 'InternalError', String(e)); } catch { /* closed */ } });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    endpoint: `http://127.0.0.1:${port}`, bucket, accessKeyId, objects, log: fake.log,
    get multipartCompleted() { return fake.multipartCompleted; },
    failWrites(count, status = 500) { failing = { count, status }; },
    put(key, body, at = new Date()) { objects.set(key, { body: Buffer.isBuffer(body) ? body : Buffer.from(body), at }); },
    keys(prefix = '') { return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
