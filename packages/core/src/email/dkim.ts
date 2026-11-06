import { generateKeyPairSync } from 'node:crypto';

export interface DkimKeyPair { publicKey: string; privateKeyPem: string }

/** A new RSA 2048 key pair. `publicKey` is the base64 SPKI DER, i.e. the `p=` value. */
export function generateDkimKey(): DkimKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { publicKey: publicKey.toString('base64'), privateKeyPem: privateKey };
}

/** Value of the TXT record published at `<selector>._domainkey.<domain>`. */
export const dkimTxtValue = (publicKey: string) => `v=DKIM1; k=rsa; p=${publicKey}`;
export const dkimHost = (selector: string, domain: string) => `${selector}._domainkey.${domain}`;

/** Next `shopmeN` selector given the selectors a domain already used. */
export function nextSelector(used: string[]): string {
  const n = used.map((s) => /^shopme(\d+)$/.exec(s)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
  return `shopme${(n.length ? Math.max(...n) : 0) + 1}`;
}

/** `p=` value of a DKIM TXT record (whitespace removed), or null. */
export function dkimPublicKeyOf(txt: string): string | null {
  const tags = new Map(txt.split(';').map((p) => { const i = p.indexOf('='); return i < 0 ? ['', ''] as const : [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).replace(/\s+/g, '')] as const; }));
  return tags.get('p') ?? null;
}
