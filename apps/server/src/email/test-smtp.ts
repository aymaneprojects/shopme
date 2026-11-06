import { createServer, type Server, type Socket } from 'node:net';
import { createHash, createPublicKey, createVerify } from 'node:crypto';

export interface Received { from: string; to: string[]; data: string; auth: { user: string; pass: string } | null }
export interface FakeSmtp {
  port: number;
  messages: Received[];
  /** Replace the answers: `rcpt` (default "250 ok") and `data` (default "250 queued"). */
  reply: { rcpt?: (to: string) => string; data?: () => string; greeting?: string };
  close(): Promise<void>;
}

/** A tiny local SMTP server for tests: records what it receives, answers as told. No TLS (the client skips STARTTLS when it is not offered). */
export async function startSmtp(opts: { auth?: boolean } = {}): Promise<FakeSmtp> {
  const messages: Received[] = [];
  const reply: FakeSmtp['reply'] = {};
  const sockets = new Set<Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock); sock.on('close', () => sockets.delete(sock)); sock.on('error', () => undefined);
    let cur: Received = { from: '', to: [], data: '', auth: null };
    let mode: 'cmd' | 'data' | 'auth-plain' | 'auth-user' | 'auth-pass' = 'cmd';
    let buf = ''; let authUser = '';
    const send = (l: string) => sock.write(`${l}\r\n`);
    send(reply.greeting ?? '220 test.local ESMTP');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      for (;;) {
        if (mode === 'data') {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          cur.data = buf.slice(0, end + 2); buf = buf.slice(end + 5); mode = 'cmd';
          const r = reply.data?.() ?? '250 2.0.0 queued as TEST1';
          if (r.startsWith('250')) messages.push(cur);
          cur = { from: '', to: [], data: '', auth: cur.auth };
          send(r); continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        if (mode === 'auth-plain') { const [, u, p] = Buffer.from(line, 'base64').toString().split('\0'); cur.auth = { user: u ?? '', pass: p ?? '' }; mode = 'cmd'; send('235 ok'); continue; }
        if (mode === 'auth-user') { authUser = Buffer.from(line, 'base64').toString(); mode = 'auth-pass'; send('334 UGFzc3dvcmQ6'); continue; }
        if (mode === 'auth-pass') { cur.auth = { user: authUser, pass: Buffer.from(line, 'base64').toString() }; mode = 'cmd'; send('235 ok'); continue; }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) { sock.write(`250-test.local\r\n${opts.auth ? '250-AUTH PLAIN LOGIN\r\n' : ''}250 8BITMIME\r\n`); }
        else if (cmd.startsWith('HELO')) send('250 test.local');
        else if (cmd.startsWith('AUTH PLAIN')) { const arg = line.slice(11).trim(); if (arg) { const [, u, p] = Buffer.from(arg, 'base64').toString().split('\0'); cur.auth = { user: u ?? '', pass: p ?? '' }; send('235 ok'); } else { mode = 'auth-plain'; send('334 '); } }
        else if (cmd.startsWith('AUTH LOGIN')) { mode = 'auth-user'; send('334 VXNlcm5hbWU6'); }
        else if (cmd.startsWith('MAIL FROM')) { cur.from = /<([^>]*)>/.exec(line)?.[1] ?? ''; send('250 ok'); }
        else if (cmd.startsWith('RCPT TO')) { const to = /<([^>]*)>/.exec(line)?.[1] ?? ''; const r = reply.rcpt?.(to) ?? '250 ok'; if (r.startsWith('250')) cur.to.push(to); send(r); }
        else if (cmd === 'DATA') { mode = 'data'; send('354 go ahead'); }
        else if (cmd === 'RSET') send('250 ok');
        else if (cmd === 'QUIT') { send('221 bye'); sock.end(); return; }
        else send('250 ok');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, messages, reply, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }) };
}

/** A port nothing listens on (connection refused). */
export async function closedPort(): Promise<number> {
  const s = await startSmtp();
  const p = s.port;
  await s.close();
  return p;
}

// ---- DKIM verification (RFC 6376, relaxed/relaxed, rsa-sha256), enough to check what nodemailer signed ---------------------------

const unfold = (v: string) => v.replace(/\r\n[ \t]/g, ' ');
const relaxedHeader = (name: string, value: string) => `${name.toLowerCase()}:${unfold(value).replace(/[ \t]+/g, ' ').trim()}`;
function relaxedBody(body: string): string {
  const lines = body.split('\r\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

export interface DkimVerdict { ok: boolean; domain: string; selector: string; signedHeaders: string[]; reason?: string }
/** Verify the DKIM-Signature of a raw message against a base64 SPKI public key. */
export function verifyDkim(raw: string, publicKeyB64: string): DkimVerdict {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split); const body = raw.slice(split + 4);
  const headers: Array<[string, string]> = [];
  for (const block of head.replace(/\r\n([ \t])/g, '\r\n$1').split(/\r\n(?![ \t])/)) { const i = block.indexOf(':'); if (i > 0) headers.push([block.slice(0, i), block.slice(i + 1)]); }
  const sigHeader = [...headers].reverse().find(([n]) => n.toLowerCase() === 'dkim-signature');
  if (!sigHeader) return { ok: false, domain: '', selector: '', signedHeaders: [], reason: 'no DKIM-Signature' };
  const tags = Object.fromEntries(unfold(sigHeader[1]).split(';').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).replace(/\s+/g, '')]; }));
  const info = { domain: tags.d ?? '', selector: tags.s ?? '', signedHeaders: (tags.h ?? '').split(':') };
  if (createHash('sha256').update(relaxedBody(body)).digest('base64') !== tags.bh) return { ok: false, ...info, reason: 'body hash mismatch' };
  const used = new Map<string, number>();
  const parts: string[] = [];
  for (const h of info.signedHeaders) {
    const all = headers.filter(([n]) => n.toLowerCase() === h.toLowerCase());
    const idx = used.get(h.toLowerCase()) ?? 0;
    const hdr = all[all.length - 1 - idx];
    used.set(h.toLowerCase(), idx + 1);
    if (hdr) parts.push(`${relaxedHeader(hdr[0], hdr[1])}\r\n`);
  }
  const sigNoB = unfold(sigHeader[1]).replace(/(\bb=)[^;]*/, '$1');
  const data = parts.join('') + relaxedHeader(sigHeader[0], sigNoB);
  const pem = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
  const ok = createVerify('RSA-SHA256').update(data).verify(pem, Buffer.from(tags.b ?? '', 'base64'));
  return { ok, ...info, reason: ok ? undefined : 'signature mismatch' };
}
