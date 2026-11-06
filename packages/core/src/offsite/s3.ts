import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { guardedLookup, isPrivateAddress, resolvesToPrivate } from '../services/net-guard';

/** What the S3 client needs: the stored destination with its secret already decrypted. */
export interface S3Target { endpoint: string; region: string; forcePathStyle: boolean; bucket: string; accessKeyId: string; secretAccessKey: string }

export class EndpointError extends Error {
  constructor(message: string, readonly field: 'endpoint' | 'bucket' | 'region' = 'endpoint') { super(message); this.name = 'EndpointError'; }
}

/**
 * Check the endpoint before any request: a well-formed https URL (http only for private networks that were allowed) whose host is
 * not private or loopback, unless `allowPrivate` (`BACKUP_ALLOW_PRIVATE_ENDPOINTS=true`). Connections are checked again at connect time.
 */
export async function validateEndpoint(endpoint: string, allowPrivate: boolean): Promise<URL> {
  const raw = endpoint.trim();
  if (!raw) throw new EndpointError('Enter the endpoint of your storage provider');
  if (/[{}<>]/.test(raw)) throw new EndpointError('Replace the placeholder in the endpoint (for example your account id)');
  let url: URL;
  try { url = new URL(raw); } catch { throw new EndpointError('The endpoint is not a valid address (for example https://s3.example.com)'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new EndpointError('The endpoint must start with https://');
  if (url.username || url.password) throw new EndpointError('Do not put credentials in the endpoint');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const literal = isIP(host) !== 0;
  if (!allowPrivate) {
    if (url.protocol !== 'https:') throw new EndpointError('The endpoint must start with https://');
    if (host === 'localhost' || host.endsWith('.localhost') || (literal ? isPrivateAddress(host) : await resolvesToPrivate(host))) {
      throw new EndpointError('This endpoint is on a private or loopback network and cannot be used');
    }
  }
  return url;
}

export function makeClient(t: S3Target, allowPrivate: boolean): S3Client {
  const lookup = guardedLookup(allowPrivate);
  return new S3Client({
    endpoint: t.endpoint.trim(),
    region: t.region.trim() || 'us-east-1',
    forcePathStyle: t.forcePathStyle,
    credentials: { accessKeyId: t.accessKeyId, secretAccessKey: t.secretAccessKey },
    // Many S3-compatible services reject the optional checksum headers newer SDKs add by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
    requestHandler: { httpAgent: new HttpAgent({ lookup, keepAlive: true }), httpsAgent: new HttpsAgent({ lookup, keepAlive: true }), connectionTimeout: 15_000, requestTimeout: 120_000 },
  });
}

/** Upload a stream of unknown length: one PutObject when it is small, a multipart upload otherwise. Memory stays at a few parts (about 16 MB). */
export const PART_SIZE = 8 * 1024 * 1024;
export async function putStream(client: S3Client, bucket: string, key: string, body: Readable, opts: { partSize?: number } = {}): Promise<number> {
  let bytes = 0;
  const counted = new PassThrough();
  counted.on('data', (c: Buffer) => { bytes += c.length; });
  body.on('error', (e) => counted.destroy(e));
  body.pipe(counted);
  const up = new Upload({ client, params: { Bucket: bucket, Key: key, Body: counted, ContentType: 'application/octet-stream' }, partSize: opts.partSize ?? PART_SIZE, queueSize: 2, leavePartsOnError: false });
  try { await up.done(); } catch (e) { body.destroy(); throw e; }
  return bytes;
}

export async function getStream(client: S3Client, bucket: string, key: string): Promise<{ body: Readable; size: number | null }> {
  const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!r.Body) throw new Error('The object is empty');
  return { body: r.Body as Readable, size: r.ContentLength ?? null };
}

export interface RemoteObject { key: string; size: number; lastModified: Date | null }
export async function listObjects(client: S3Client, bucket: string, prefix: string): Promise<RemoteObject[]> {
  const out: RemoteObject[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0), lastModified: o.LastModified ?? null });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export const deleteObject = (client: S3Client, bucket: string, key: string) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

export interface ConnectionStep { step: 'write' | 'read' | 'delete'; ok: boolean; error?: string }
export interface ConnectionResult { ok: boolean; steps: ConnectionStep[]; error?: string }

/** Friendly text for the failures people actually hit; the raw message otherwise (never the credentials). */
export function describeS3Error(e: unknown): string {
  const err = e as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number }; code?: string };
  const name = err.name ?? err.Code ?? err.code ?? '';
  const status = err.$metadata?.httpStatusCode;
  if (e instanceof EndpointError) return e.message;
  if (name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch' || status === 401) return 'The provider refused the access key or secret';
  if (name === 'AccessDenied' || status === 403) return 'Access denied: the key may not be allowed to write to this bucket';
  if (name === 'NoSuchBucket' || status === 404) return 'The bucket was not found at this endpoint (check its name and the region)';
  if (name === 'ENOTFOUND' || err.code === 'ENOTFOUND') return 'The endpoint host could not be found';
  if (err.code === 'ECONNREFUSED') return 'The endpoint refused the connection';
  if (name === 'BlockedAddressError') return 'This endpoint is on a private or loopback network and cannot be used';
  if (err.code === 'ETIMEDOUT' || name === 'TimeoutError') return 'The endpoint did not answer in time';
  return String(err.message ?? name ?? 'Request failed').slice(0, 300);
}

/** Write, read back and delete a small object under `prefix`: the whole trip a backup needs. */
export async function testConnection(t: S3Target, prefix: string, allowPrivate: boolean, deps: { client?: S3Client } = {}): Promise<ConnectionResult> {
  const steps: ConnectionStep[] = [];
  const done = (error?: string): ConnectionResult => ({ ok: steps.every((s) => s.ok) && steps.length === 3 && !error, steps, ...(error ? { error } : {}) });
  try { await validateEndpoint(t.endpoint, allowPrivate); } catch (e) { return done(describeS3Error(e)); }
  if (!t.bucket.trim()) return done('Enter the bucket name');
  if (!t.accessKeyId.trim() || !t.secretAccessKey) return done('Enter the access key and its secret');
  const client = deps.client ?? makeClient(t, allowPrivate);
  const key = `${prefix}.shopme-connection-test-${Date.now().toString(36)}`;
  const payload = Buffer.from(`shopme connection test ${Math.random().toString(36).slice(2)}`);
  try {
    try { await client.send(new PutObjectCommand({ Bucket: t.bucket, Key: key, Body: payload, ContentType: 'text/plain' })); steps.push({ step: 'write', ok: true }); }
    catch (e) { steps.push({ step: 'write', ok: false, error: describeS3Error(e) }); return done(steps[0]!.error); }
    try {
      const r = await client.send(new GetObjectCommand({ Bucket: t.bucket, Key: key }));
      const got = Buffer.from(await r.Body!.transformToByteArray());
      if (!got.equals(payload)) throw new Error('The object read back is not the one that was written');
      steps.push({ step: 'read', ok: true });
    } catch (e) { steps.push({ step: 'read', ok: false, error: describeS3Error(e) }); }
    try { await client.send(new DeleteObjectCommand({ Bucket: t.bucket, Key: key })); steps.push({ step: 'delete', ok: true }); }
    catch (e) { steps.push({ step: 'delete', ok: false, error: describeS3Error(e) }); }
    const bad = steps.find((s) => !s.ok);
    return done(bad?.error);
  } finally { if (!deps.client) client.destroy(); }
}
