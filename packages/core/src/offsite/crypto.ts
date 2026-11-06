import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Client-side encryption of off-site backups (AES-256-GCM), done before a single byte leaves the server.
 *
 * File format `SMENC1`, chosen so a backup can be decrypted without ShopMe (see `scripts/decrypt-backup.mjs`):
 *   header   magic "SMENC1" (6) | scrypt salt (16) | nonce prefix (4) | chunk size, u32 big-endian (4)
 *   chunks   ciphertext (<= chunk size) | GCM tag (16), repeated
 * Key = scrypt(passphrase, salt, N=2^15, r=8, p=1, 32 bytes). Chunk i is sealed with nonce = prefix | i (u64 big-endian) and
 * the associated data byte 1 for the last chunk, 0 for the others, so a truncated, reordered or altered file fails to decrypt.
 * Chunks keep memory flat whatever the archive size: the server never holds more than one chunk.
 */
export const ENC_MAGIC = Buffer.from('SMENC1');
export const ENC_CHUNK = 64 * 1024;
const SALT = 16;
const PREFIX = 4;
const TAG = 16;
const HEADER = ENC_MAGIC.length + SALT + PREFIX + 4;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

const deriveKey = (passphrase: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(passphrase.normalize('NFKC'), salt, 32, SCRYPT, (e, k) => (e ? reject(e) : resolve(k))));
const nonce = (prefix: Buffer, i: number) => { const n = Buffer.alloc(12); prefix.copy(n); n.writeBigUInt64BE(BigInt(i), PREFIX); return n; };

export class WrongPassphraseError extends Error {
  constructor() { super('The file could not be decrypted: the passphrase is wrong or the file is damaged'); this.name = 'WrongPassphraseError'; }
}

/** A Transform that encrypts what is written to it. The key is derived first, so build it with `await`. */
export async function createEncryptor(passphrase: string): Promise<Transform> {
  const salt = randomBytes(SALT);
  const noncePrefix = randomBytes(PREFIX);
  const key = await deriveKey(passphrase, salt);
  let held: Buffer = Buffer.alloc(0); // the last chunk is kept back until we know whether it is the final one
  let index = 0;
  const seal = (plain: Buffer, last: boolean) => {
    const c = createCipheriv('aes-256-gcm', key, nonce(noncePrefix, index++));
    c.setAAD(Buffer.from([last ? 1 : 0]));
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([body, c.getAuthTag()]);
  };
  const head = Buffer.alloc(HEADER);
  ENC_MAGIC.copy(head); salt.copy(head, ENC_MAGIC.length); noncePrefix.copy(head, ENC_MAGIC.length + SALT); head.writeUInt32BE(ENC_CHUNK, ENC_MAGIC.length + SALT + PREFIX);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (!started) { started = true; this.push(head); }
      held = held.length ? Buffer.concat([held, chunk]) : chunk;
      while (held.length > ENC_CHUNK) { this.push(seal(held.subarray(0, ENC_CHUNK), false)); held = held.subarray(ENC_CHUNK); }
      cb();
    },
    flush(cb: TransformCallback) {
      if (!started) { started = true; this.push(head); }
      this.push(seal(held, true));
      cb();
    },
  });
}

/** A Transform that decrypts a `SMENC1` stream. Fails with {@link WrongPassphraseError} when the passphrase is wrong or the data was altered. */
export function createDecryptor(passphrase: string): Transform {
  let buf: Buffer = Buffer.alloc(0);
  let key: Buffer | null = null;
  let prefix: Buffer = Buffer.alloc(0);
  let size = ENC_CHUNK;
  let index = 0;
  const open = (record: Buffer, last: boolean) => {
    const d = createDecipheriv('aes-256-gcm', key!, nonce(prefix, index++));
    d.setAAD(Buffer.from([last ? 1 : 0]));
    d.setAuthTag(record.subarray(record.length - TAG));
    try { return Buffer.concat([d.update(record.subarray(0, record.length - TAG)), d.final()]); } catch { throw new WrongPassphraseError(); }
  };
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      void (async () => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        if (!key) {
          if (buf.length < HEADER) return;
          if (!buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) throw new Error('This file is not an encrypted ShopMe backup');
          const salt = Buffer.from(buf.subarray(ENC_MAGIC.length, ENC_MAGIC.length + SALT));
          prefix = Buffer.from(buf.subarray(ENC_MAGIC.length + SALT, ENC_MAGIC.length + SALT + PREFIX));
          size = buf.readUInt32BE(ENC_MAGIC.length + SALT + PREFIX);
          if (size < 1 || size > 16 * 1024 * 1024) throw new Error('Unsupported encrypted file');
          buf = buf.subarray(HEADER);
          key = await deriveKey(passphrase, salt);
        }
        // A full record is only opened once more data follows it: until then it might be the last one.
        while (buf.length > size + TAG) { t.push(open(buf.subarray(0, size + TAG), false)); buf = buf.subarray(size + TAG); }
      })().then(() => cb(), (e) => cb(e as Error));
    },
    flush(cb: TransformCallback) {
      try {
        if (!key) throw new Error('This file is not an encrypted ShopMe backup');
        if (buf.length < TAG) throw new WrongPassphraseError();
        t.push(open(buf, true));
        cb();
      } catch (e) { cb(e as Error); }
    },
  });
  return t;
}
