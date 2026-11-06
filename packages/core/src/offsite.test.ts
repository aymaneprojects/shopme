import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRetention, clampRetention, createDecryptor, createEncryptor, EndpointError, getStream, isoWeek, listObjects, makeClient, normalizePrefix, offsiteAlert, parseObjectName, patchFromInput, presetEndpoint, presetById,
  putStream, STORAGE_PRESETS, testConnection, validateEndpoint, WrongPassphraseError, ENC_CHUNK, backoffMs, folderOf, rootOf, type RunRow, type S3Target, deleteObject,
} from './index';
import { startFakeS3, type FakeS3 } from '../test-fixtures/fake-s3';

const collect = async (r: NodeJS.ReadableStream) => { const c: Buffer[] = []; for await (const x of r) c.push(x as Buffer); return Buffer.concat(c); };
const encrypt = async (data: Buffer, pass: string, pieces = 1) => {
  const enc = await createEncryptor(pass);
  const size = Math.max(1, Math.ceil(data.length / pieces));
  const chunks = Array.from({ length: pieces }, (_, i) => data.subarray(i * size, (i + 1) * size));
  return collect(Readable.from(chunks).pipe(enc));
};
const decrypt = async (blob: Buffer, pass: string) => {
  const d = createDecryptor(pass);
  const out = collect(d);
  d.on('error', () => undefined);
  d.end(blob);
  return out;
};

describe('client-side encryption (AES-256-GCM)', () => {
  it('round-trips empty, small, chunk-aligned and multi-chunk data, however the input is cut up', async () => {
    for (const n of [0, 1, 1000, ENC_CHUNK, ENC_CHUNK * 2, ENC_CHUNK * 3 + 17]) {
      const data = randomBytes(n);
      const blob = await encrypt(data, 'correct horse battery', 3);
      expect(blob.length).toBeGreaterThan(n);
      expect((await decrypt(blob, 'correct horse battery')).equals(data), `size ${n}`).toBe(true);
    }
  }, 60_000);

  it('does not contain the plaintext and differs every time (random salt and nonce)', async () => {
    const data = Buffer.from('customer@example.com '.repeat(500));
    const a = await encrypt(data, 'passphrase-1');
    const b = await encrypt(data, 'passphrase-1');
    expect(a.includes(Buffer.from('customer@example.com'))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('refuses a wrong passphrase, a flipped bit and a truncated file', async () => {
    const data = randomBytes(ENC_CHUNK * 2 + 5);
    const blob = await encrypt(data, 'passphrase-1');
    await expect(decrypt(blob, 'passphrase-2')).rejects.toBeInstanceOf(WrongPassphraseError);
    const flipped = Buffer.from(blob); flipped[flipped.length - 40] = flipped[flipped.length - 40]! ^ 1;
    await expect(decrypt(flipped, 'passphrase-1')).rejects.toBeInstanceOf(WrongPassphraseError);
    // dropping the last chunk must not look like a shorter, valid file
    const cut = blob.subarray(0, blob.length - (ENC_CHUNK + 16) + 0);
    await expect(decrypt(cut.subarray(0, cut.length - 3), 'passphrase-1')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(decrypt(Buffer.from('not an encrypted backup at all, just text'), 'x')).rejects.toThrow(/not an encrypted/);
  }, 60_000);

  it('can be decrypted by the standalone script, without ShopMe', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shopme-dec-'));
    const data = randomBytes(ENC_CHUNK + 123);
    writeFileSync(path.join(dir, 'in.enc'), await encrypt(data, 'a long passphrase'));
    const script = fileURLToPath(new URL('../../../scripts/decrypt-backup.mjs', import.meta.url));
    execFileSync('node', [script, path.join(dir, 'in.enc'), path.join(dir, 'out.bin')], { env: { ...process.env, SHOPME_BACKUP_PASSPHRASE: 'a long passphrase' } });
    expect(readFileSync(path.join(dir, 'out.bin')).equals(data)).toBe(true);
    expect(() => execFileSync('node', [script, path.join(dir, 'in.enc'), path.join(dir, 'bad.bin')], { env: { ...process.env, SHOPME_BACKUP_PASSPHRASE: 'wrong passphrase' }, stdio: 'pipe' })).toThrow();
  }, 60_000);
});

describe('retention schedule', () => {
  const at = (s: string) => new Date(`${s}T12:00:00Z`);
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => { const d = at(from); d.setUTCDate(d.getUTCDate() - i); return { key: d.toISOString().slice(0, 10), at: d }; });

  it('keeps the newest per day, week and month, and deletes the rest', () => {
    // 100 daily backups ending on 2026-11-06
    const items = days('2026-11-06', 100);
    const { keep, remove } = applyRetention(items, { keepDaily: 7, keepWeekly: 4, keepMonthly: 3 });
    const kept = new Set(keep.map((k) => k.key));
    for (let i = 0; i < 7; i++) expect(kept.has(days('2026-11-06', 7)[i]!.key)).toBe(true); // the last 7 days
    // weekly: the newest of each of the last 4 ISO weeks (Mon 2026-11-02 week starts today's: the newest is 11-06)
    expect(kept.has('2026-11-06')).toBe(true);
    expect(kept.has('2026-11-01')).toBe(true); // Sunday, newest of the week of Oct 26
    expect(kept.has('2026-10-25')).toBe(true);
    expect(kept.has('2026-10-18')).toBe(true);
    expect(kept.has('2026-10-17')).toBe(false); // older than 4 weeks and not the newest of its month
    // monthly: newest backup of Nov (11-06), Oct (10-31), Sep (09-30)
    expect(kept.has('2026-10-31')).toBe(true);
    expect(kept.has('2026-09-30')).toBe(true);
    expect(kept.has('2026-08-31')).toBe(false);
    expect(keep.length + remove.length).toBe(100);
    expect(keep.length).toBe(kept.size);
  });

  it('counts days that have a backup, so a quiet period does not erase history', () => {
    const items = [at('2026-11-06'), at('2026-10-01'), at('2026-09-20'), at('2026-09-19')].map((d) => ({ key: d.toISOString(), at: d }));
    const { remove } = applyRetention(items, { keepDaily: 3, keepWeekly: 0, keepMonthly: 0 });
    expect(remove.map((r) => r.key)).toEqual([at('2026-09-19').toISOString()]);
  });

  it('keeps only the newest backup of a busy day, and always the newest overall', () => {
    const day = new Date('2026-11-06T00:00:00Z');
    const items = [1, 5, 9, 20].map((h) => ({ key: `h${h}`, at: new Date(day.getTime() + h * 3600_000) }));
    expect(applyRetention(items, { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 }).keep.map((k) => k.key)).toEqual(['h20']);
    expect(applyRetention(items, { keepDaily: 0 as never, keepWeekly: 0, keepMonthly: 0 }).keep.map((k) => k.key)).toEqual(['h20']);
    expect(applyRetention([], clampRetention({})).keep).toEqual([]);
  });

  it('breaks ties between backups of the same second deterministically', () => {
    const at = new Date('2026-11-06T03:00:00Z');
    const r = applyRetention([{ key: 'a.shopme', at }, { key: 'a.shopme.enc', at }], { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 });
    expect(r.keep.map((k) => k.key)).toEqual(['a.shopme.enc']);
  });

  it('numbers ISO weeks across year boundaries and clamps the settings', () => {
    expect(isoWeek(new Date('2026-01-01T10:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(new Date('2027-01-01T10:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2026-12-28T10:00:00Z'))).toBe('2026-W53');
    expect(clampRetention({ keepDaily: 0, keepWeekly: -3, keepMonthly: 9999 })).toEqual({ keepDaily: 1, keepWeekly: 0, keepMonthly: 365 });
    expect(clampRetention({})).toEqual({ keepDaily: 7, keepWeekly: 4, keepMonthly: 6 });
  });
});

describe('names, folders and presets', () => {
  it('parses only the names ShopMe writes', () => {
    expect(parseObjectName('backup-2026-11-06T03-30-00Z.shopme')).toMatchObject({ kind: 'store', encrypted: false, at: new Date('2026-11-06T03:30:00Z') });
    expect(parseObjectName('db-2026-11-06T03-30-00Z.dump.enc')).toMatchObject({ kind: 'database', encrypted: true });
    for (const n of ['notes.txt', 'backup-2026-11-06.shopme', 'backup-2026-11-06T03-30-00Z.dump', '.shopme-connection-test-abc', 'backup-2026-13-45T99-99-99Z.shopme']) expect(parseObjectName(n), n).toBeNull();
  });
  it('lays objects out per store and for the platform', () => {
    expect(folderOf(7, 'store', 7, 'backups/')).toBe('backups/shop-7/archives/');
    expect(folderOf(7, 'database', null, '')).toBe('shop-7/database/');
    expect(folderOf(null, 'store', 3, 'x/')).toBe('x/platform/archives/shop-3/');
    expect(rootOf(null, '')).toBe('platform/');
    expect(normalizePrefix(' /a//b/ ')).toBe('a/b/');
    expect(normalizePrefix('')).toBe('');
  });
  it('has the seven presets with usable endpoints', () => {
    expect(STORAGE_PRESETS.map((p) => p.id)).toEqual(['b2', 'scaleway', 'ovh', 'wasabi', 'r2', 'aws', 'custom']);
    expect(presetEndpoint(presetById('scaleway')!, 'nl-ams')).toBe('https://s3.nl-ams.scw.cloud');
    expect(presetEndpoint(presetById('b2')!, '')).toBe('https://s3.us-west-004.backblazeb2.com');
    expect(presetById('r2')!.needs).toBe('account');
    expect(presetById('custom')!.pathStyle).toBe(true);
  });
  it('backs off 5 min, 15 min, 1 h, 4 h', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([300_000, 900_000, 3_600_000, 14_400_000, 14_400_000]);
  });
});

describe('endpoint validation', () => {
  it('refuses private and loopback hosts unless allowed', async () => {
    for (const e of ['https://127.0.0.1:9000', 'https://localhost:9000', 'https://10.0.0.5', 'https://192.168.1.2', 'https://169.254.169.254', 'https://[::1]:9000', 'http://s3.example.com', 'ftp://s3.example.com']) {
      await expect(validateEndpoint(e, false), e).rejects.toBeInstanceOf(EndpointError);
    }
    await expect(validateEndpoint('http://127.0.0.1:9000', true)).resolves.toBeInstanceOf(URL);
    await expect(validateEndpoint('https://localhost:9000', true)).resolves.toBeInstanceOf(URL);
    await expect(validateEndpoint('https://8.8.8.8', false)).resolves.toBeInstanceOf(URL);
  });
  it('refuses placeholders, credentials and garbage', async () => {
    await expect(validateEndpoint('https://{account}.r2.cloudflarestorage.com', false)).rejects.toThrow(/placeholder/);
    await expect(validateEndpoint('https://user:pw@8.8.8.8', false)).rejects.toThrow(/credentials/);
    await expect(validateEndpoint('not a url', false)).rejects.toThrow(/valid address/);
    await expect(validateEndpoint('', false)).rejects.toThrow();
  });
  it('validates the whole form and encrypts the secrets', async () => {
    const r = await patchFromInput(null, { endpoint: 'https://127.0.0.1', bucket: 'Bad Bucket', prefix: '../x', accessKeyId: 'a b', passphrase: 'short' }, 'k', false);
    expect('errors' in r && r.errors.map((e) => e.field).sort()).toEqual(['accessKeyId', 'bucket', 'endpoint', 'passphrase', 'prefix']);
    const ok = await patchFromInput(null, { endpoint: 'https://8.8.8.8/', bucket: 'my-bucket', prefix: '/shop//backups', accessKeyId: 'AKIA1', secretAccessKey: 'super-secret-value', passphrase: 'a long passphrase', keepDaily: 0, keepMonthly: 12 }, 'k', false);
    expect('patch' in ok).toBe(true);
    if ('patch' in ok) {
      expect(ok.patch).toMatchObject({ endpoint: 'https://8.8.8.8', bucket: 'my-bucket', prefix: 'shop/backups/', keepDaily: 1, keepMonthly: 12 });
      expect(JSON.stringify(ok.patch)).not.toContain('super-secret-value');
      expect(JSON.stringify(ok.patch)).not.toContain('a long passphrase');
      expect(ok.patch.secretKeyEnc).toBeTruthy();
    }
  });
});

describe('S3 client against the in-process S3', () => {
  let s3: FakeS3;
  const target = (o: Partial<S3Target> = {}): S3Target => ({ endpoint: s3.endpoint, region: 'us-east-1', forcePathStyle: true, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: 'shh-secret', ...o });
  beforeAll(async () => { s3 = await startFakeS3({ pageSize: 3 }); });
  afterAll(async () => { await s3.close(); });

  it('the connection test writes, reads and deletes a small object, and leaves nothing behind', async () => {
    const before = s3.log.length;
    const r = await testConnection(target(), 'backups/shop-1/', true);
    expect(r).toEqual({ ok: true, steps: [{ step: 'write', ok: true }, { step: 'read', ok: true }, { step: 'delete', ok: true }] });
    expect(s3.log.slice(before).map((l) => l.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(s3.keys()).toEqual([]);
    expect(s3.log.slice(before)[0]!.path).toMatch(/^\/test-bucket\/backups\/shop-1\/\.shopme-connection-test-/);
  });

  it('explains a wrong key, a missing bucket and a refused private endpoint', async () => {
    expect(await testConnection(target({ accessKeyId: 'AKIAWRONG' }), '', true)).toMatchObject({ ok: false, error: expect.stringMatching(/access key or secret/) });
    expect(await testConnection(target({ bucket: 'nope-bucket' }), '', true)).toMatchObject({ ok: false, error: expect.stringMatching(/bucket was not found/) });
    expect(await testConnection(target(), '', false)).toMatchObject({ ok: false, error: expect.stringMatching(/private or loopback|https/) });
    expect(await testConnection(target({ bucket: '' }), '', true)).toMatchObject({ ok: false, error: 'Enter the bucket name' });
    expect(await testConnection(target({ endpoint: 'http://127.0.0.1:1' }), '', true)).toMatchObject({ ok: false });
  });

  it('uploads a small stream with one PutObject and a large one with a multipart upload, byte for byte', async () => {
    const client = makeClient(target(), true);
    const small = randomBytes(10_000);
    await putStream(client, s3.bucket, 'small.bin', Readable.from([small]));
    expect(s3.multipartCompleted).toBe(0);
    expect(s3.objects.get('small.bin')!.body.equals(small)).toBe(true);

    // 21 MB cut into 1 MB pieces: the stream is never held whole; the upload goes out in 8 MB parts
    const big = randomBytes(21 * 1024 * 1024);
    const pieces = Array.from({ length: 21 }, (_, i) => big.subarray(i * 1024 * 1024, (i + 1) * 1024 * 1024));
    const sent = await putStream(client, s3.bucket, 'big.bin', Readable.from(pieces));
    expect(sent).toBe(big.length);
    expect(s3.multipartCompleted).toBe(1);
    const parts = s3.log.filter((l) => l.method === 'PUT' && l.query.includes('partNumber'));
    expect(parts.length).toBe(3);
    expect(Math.max(...parts.map((p) => p.bytes))).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(s3.objects.get('big.bin')!.body.equals(big)).toBe(true);
    client.destroy();
  }, 60_000);

  it('uploads encrypted and downloads decrypted, and pages through listings', async () => {
    const client = makeClient(target(), true);
    const data = randomBytes(ENC_CHUNK * 3 + 9);
    const enc = await createEncryptor('my passphrase');
    await putStream(client, s3.bucket, 'enc/backup.shopme.enc', Readable.from([data]).pipe(enc));
    expect(s3.objects.get('enc/backup.shopme.enc')!.body.includes(data.subarray(0, 64))).toBe(false);
    const { body } = await getStream(client, s3.bucket, 'enc/backup.shopme.enc');
    expect((await collect(body.pipe(createDecryptor('my passphrase')))).equals(data)).toBe(true);
    for (let i = 0; i < 7; i++) s3.put(`list/o-${i}`, 'x');
    const listed = await listObjects(client, s3.bucket, 'list/');
    expect(listed.map((o) => o.key)).toEqual(Array.from({ length: 7 }, (_, i) => `list/o-${i}`)); // 3 pages of 3
    await deleteObject(client, s3.bucket, 'list/o-0');
    expect((await listObjects(client, s3.bucket, 'list/')).length).toBe(6);
    client.destroy();
  });

  it('aborts and fails when the source stream breaks', async () => {
    const client = makeClient(target(), true);
    const broken = new Readable({ read() { this.push(randomBytes(1000)); this.destroy(new Error('disk read error')); } });
    await expect(putStream(client, s3.bucket, 'broken.bin', broken)).rejects.toThrow();
    expect(s3.objects.has('broken.bin')).toBe(false);
    client.destroy();
  });
});

describe('banner condition', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
  let id = 0;
  const run = (o: Partial<RunRow>): RunRow => ({ id: ++id, shopId: 1, subjectShopId: 1, kind: 'store', trigger: 'scheduled', status: 'ok', attempts: 1, nextAttemptAt: null, sourceName: null, objectKey: 'k', bytes: 10, encrypted: false, error: null, startedAt: ago(1), finishedAt: ago(1), ...o });
  const dest = { enabled: true, createdAt: ago(500), updatedAt: ago(500) };

  it('is quiet when the newest upload is good and recent', () => {
    expect(offsiteAlert(dest, true, [run({ finishedAt: ago(30) })], now)).toBeNull();
  });
  it('fires when the last upload failed, and says whether a retry is pending', () => {
    expect(offsiteAlert(dest, true, [run({ finishedAt: ago(30) }), run({ status: 'retry', error: 'boom', finishedAt: ago(1) })], now)).toMatchObject({ kind: 'failed', error: 'boom', retrying: true });
    expect(offsiteAlert(dest, true, [run({ finishedAt: ago(30) }), run({ status: 'failed', error: 'boom' })], now)).toMatchObject({ kind: 'failed', retrying: false });
  });
  it('clears once a later upload of the same kind worked', () => {
    expect(offsiteAlert(dest, true, [run({ status: 'failed', error: 'x', finishedAt: ago(5) }), run({ finishedAt: ago(1) })], now)).toBeNull();
    // a good archive does not clear a failed database dump
    expect(offsiteAlert(dest, true, [run({ kind: 'database', subjectShopId: null, status: 'failed', error: 'dump' }), run({})], now)).toMatchObject({ kind: 'failed', error: 'dump' });
  });
  it('fires when the newest good upload is older than 48 hours, or none ever happened on an old destination', () => {
    expect(offsiteAlert(dest, true, [run({ finishedAt: ago(47) })], now)).toBeNull();
    expect(offsiteAlert(dest, true, [run({ finishedAt: ago(49) })], now)).toMatchObject({ kind: 'stale' });
    expect(offsiteAlert(dest, true, [], now)).toMatchObject({ kind: 'stale', lastOkAt: null });
    expect(offsiteAlert({ ...dest, updatedAt: ago(2) }, true, [], now)).toBeNull(); // just set up
  });
  it('stays quiet when the destination is off or incomplete', () => {
    expect(offsiteAlert({ ...dest, enabled: false }, true, [run({ status: 'failed' })], now)).toBeNull();
    expect(offsiteAlert(dest, false, [run({ status: 'failed' })], now)).toBeNull();
    expect(offsiteAlert(null, false, [], now)).toBeNull();
  });
});
