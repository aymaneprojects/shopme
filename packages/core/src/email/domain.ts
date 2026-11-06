import { isIP } from 'node:net';

/** `"Name" <a@b.c>` / `Name <a@b.c>` / `a@b.c` -> parts. */
export function parseMailAddress(v: string): { name: string | null; address: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(v);
  if (m) return { name: m[1]?.trim() || null, address: m[2]!.trim() };
  return { name: null, address: v.trim() };
}

/** A DNS host name with at least one dot (labels of letters, digits, hyphens). No IP literals, no `localhost`. */
export function isHostname(h: string): boolean {
  if (h.length < 3 || h.length > 253 || isIP(h)) return false;
  const labels = h.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(l)) && /[a-z]/i.test(labels[labels.length - 1]!);
}

/** Lower-cased domain of an e-mail address, or null. */
export function sendingDomainOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  const d = at < 0 ? '' : address.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  return isHostname(d) ? d : null;
}

/** True for names that cannot be a real sending domain (local development names). */
export const isLocalDomain = (d: string) => d === 'localhost' || d.endsWith('.localhost') || d.endsWith('.local') || d.endsWith('.test') || d.endsWith('.invalid') || d.endsWith('.example') || d.endsWith('.internal');

const FREE = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'yahoo.co.uk', 'yahoo.de', 'yahoo.es', 'yahoo.it', 'ymail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk', 'hotmail.de', 'hotmail.es', 'hotmail.it',
  'outlook.com', 'outlook.fr', 'live.com', 'live.fr', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'gmx.fr', 'web.de',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'neuf.fr', 'bbox.fr', 't-online.de', 'libero.it', 'tutanota.com', 'tuta.io', 'fastmail.com',
]);
/** Free mailbox providers: mail From such an address from another server fails DMARC. */
export const isFreeMailboxDomain = (d: string | null | undefined) => !!d && FREE.has(d.toLowerCase());

/** True when a relay host is syntactically acceptable (host name with a dot, or an IP literal). */
export const isValidRelayHost = (h: string) => h.length <= 253 && (isIP(h) !== 0 || isHostname(h));
