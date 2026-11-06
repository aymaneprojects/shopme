#!/usr/bin/env node
// Decrypt an off-site ShopMe backup (.enc) without ShopMe. Needs only Node 18 or newer.
//
//   SHOPME_BACKUP_PASSPHRASE='your passphrase' node decrypt-backup.mjs backup-2026-11-06T03-30-00Z.shopme.enc backup.shopme
//   node decrypt-backup.mjs --passphrase-file pass.txt in.enc out.shopme
//
// Format "SMENC1": magic (6) | scrypt salt (16) | nonce prefix (4) | chunk size u32 BE (4), then chunks of
// ciphertext (at most chunk size) followed by a 16-byte AES-256-GCM tag. Key: scrypt(passphrase, salt, N=32768, r=8, p=1, 32 bytes).
// Chunk i uses the nonce prefix followed by i as a 64-bit big-endian number; the additional authenticated data is one byte,
// 1 for the last chunk and 0 for the others.
import { createDecipheriv, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, rmSync } from 'node:fs';

const args = process.argv.slice(2);
let passphrase = process.env.SHOPME_BACKUP_PASSPHRASE;
const pf = args.indexOf('--passphrase-file');
if (pf >= 0) { passphrase = readFileSync(args[pf + 1], 'utf8').replace(/\r?\n$/, ''); args.splice(pf, 2); }
const [input, output] = args;
if (!input || !output || !passphrase) {
  console.error('Usage: SHOPME_BACKUP_PASSPHRASE=... node decrypt-backup.mjs <backup.enc> <output file>\n   or: node decrypt-backup.mjs --passphrase-file <file> <backup.enc> <output file>');
  process.exit(2);
}

const MAGIC = Buffer.from('SMENC1');
const HEADER = MAGIC.length + 16 + 4 + 4;
const TAG = 16;
let buf = Buffer.alloc(0);
let key = null, prefix = null, size = 0, index = 0;
const out = createWriteStream(output);

const nonce = () => { const n = Buffer.alloc(12); prefix.copy(n); n.writeBigUInt64BE(BigInt(index), 4); return n; };
function open(record, last) {
  const d = createDecipheriv('aes-256-gcm', key, nonce());
  index++;
  d.setAAD(Buffer.from([last ? 1 : 0]));
  d.setAuthTag(record.subarray(record.length - TAG));
  return Buffer.concat([d.update(record.subarray(0, record.length - TAG)), d.final()]);
}
function fail(message) { out.destroy(); rmSync(output, { force: true }); console.error(message); process.exit(1); }

try {
  for await (const chunk of createReadStream(input)) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (!key) {
      if (buf.length < HEADER) continue;
      if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) fail('This file is not an encrypted ShopMe backup.');
      const salt = buf.subarray(MAGIC.length, MAGIC.length + 16);
      prefix = Buffer.from(buf.subarray(MAGIC.length + 16, MAGIC.length + 20));
      size = buf.readUInt32BE(MAGIC.length + 20);
      key = scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      buf = buf.subarray(HEADER);
    }
    while (buf.length > size + TAG) { out.write(open(buf.subarray(0, size + TAG), false)); buf = buf.subarray(size + TAG); }
  }
  if (!key || buf.length < TAG) fail('This file is not an encrypted ShopMe backup, or it is incomplete.');
  out.write(open(buf, true));
  await new Promise((resolve) => out.end(resolve));
  console.log(`Decrypted to ${output}`);
} catch {
  fail('Could not decrypt: the passphrase is wrong, or the file is damaged or incomplete.');
}
