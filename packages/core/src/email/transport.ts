import { lookup } from 'node:dns/promises';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { isPrivateAddress } from '../services/net-guard';
import type { DnsResolver } from './dns';
import type { RelayConfig } from './store';

export interface WireMessage {
  messageId: string;
  from: string;
  envelopeFrom: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  list?: { unsubscribe: string[]; oneClick: boolean };
  dkim?: { domain: string; selector: string; privateKey: string } | null;
}

export interface DeliveryResult {
  ok: boolean;
  /** A failure that retrying cannot fix (5xx, unknown domain, null MX). */
  permanent: boolean;
  /** The remote server's last response line, when there was one. */
  response: string | null;
  error: string | null;
  /** MX host (direct) or relay host that answered last. */
  mxHost: string | null;
}

export interface DirectDeps {
  resolver: DnsResolver;
  /** SMTP port of MX hosts (25). Tests point it at a local server. */
  port?: number;
  /** Tests: map an MX host name to the host and port to connect to. */
  target?: (mx: string) => { host: string; port: number };
  /** Allow MX hosts that resolve to private or loopback addresses (`EMAIL_ALLOW_PRIVATE_HOSTS`). */
  allowPrivate: boolean;
  /** Name given in EHLO. */
  helo: string;
  timeoutMs?: number;
}

const codeOf = (e: unknown): number | null => { const c = (e as { responseCode?: number })?.responseCode; return typeof c === 'number' ? c : null; };
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/[\r\n]+/g, ' ').slice(0, 400);

function mailOptions(m: WireMessage) {
  return {
    from: m.from, to: m.to, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html, messageId: m.messageId,
    envelope: { from: m.envelopeFrom, to: [m.to] },
    headers: m.list ? { 'List-Unsubscribe': m.list.unsubscribe.map((u) => `<${u}>`).join(', '), ...(m.list.oneClick ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}) } : undefined,
    disableFileAccess: true, disableUrlAccess: true,
  };
}
const dkimOptions = (m: WireMessage) => m.dkim ? { dkim: { domainName: m.dkim.domain, keySelector: m.dkim.selector, privateKey: m.dkim.privateKey, headerFieldNames: 'from:to:subject:date:message-id:mime-version:content-type:reply-to:list-unsubscribe:list-unsubscribe-post' } } : {};

/** Addresses of `host`, private ones removed unless allowed. */
async function safeAddresses(host: string, allowPrivate: boolean): Promise<string[]> {
  const all = await lookup(host, { all: true, verbatim: true });
  return all.map((a) => a.address).filter((a) => allowPrivate || !isPrivateAddress(a)).slice(0, 3);
}

/** MX hosts of a domain in preference order, with the RFC 5321 implicit MX (the domain itself) when it has no MX record. */
export async function mxHostsOf(r: DnsResolver, domain: string): Promise<{ hosts: string[]; error?: { permanent: boolean; text: string } }> {
  try {
    const mx = await r.resolveMx(domain);
    if (mx.length === 1 && mx[0]!.exchange === '') return { hosts: [], error: { permanent: true, text: `${domain} does not accept mail (null MX)` } };
    if (mx.length) return { hosts: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.replace(/\.$/, '')) };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'ENODATA' && code !== 'ENOTFOUND' && code !== 'NXDOMAIN') return { hosts: [], error: { permanent: false, text: `MX lookup for ${domain} failed: ${msgOf(e)}` } };
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') {
      // Some resolvers answer ENOTFOUND for "no MX": the implicit MX still applies when the name has an address.
      const has = await r.resolve4(domain).then((a) => a.length > 0).catch(() => false) || await r.resolve6(domain).then((a) => a.length > 0).catch(() => false);
      return has ? { hosts: [domain] } : { hosts: [], error: { permanent: true, text: `The domain ${domain} does not exist or has no mail server` } };
    }
  }
  const has = await r.resolve4(domain).then((a) => a.length > 0).catch(() => false) || await r.resolve6(domain).then((a) => a.length > 0).catch(() => false);
  return has ? { hosts: [domain] } : { hosts: [], error: { permanent: true, text: `The domain ${domain} has no mail server` } };
}

/**
 * Deliver straight to the recipient domain's MX hosts. Each MX is tried in order (opportunistic STARTTLS, DKIM-signed); a connection
 * problem or 4xx moves on to the next one, a 5xx stops at once as a permanent failure. Everything failed softly: temporary.
 */
export async function deliverDirect(m: WireMessage, deps: DirectDeps): Promise<DeliveryResult> {
  const domain = m.to.slice(m.to.lastIndexOf('@') + 1).toLowerCase();
  const { hosts, error } = await mxHostsOf(deps.resolver, domain);
  if (error) return { ok: false, permanent: error.permanent, response: null, error: error.text, mxHost: null };
  let last: DeliveryResult = { ok: false, permanent: false, response: null, error: 'No mail server could be reached', mxHost: null };
  for (const mx of hosts) {
    const t = deps.target?.(mx);
    let addrs: string[];
    try { addrs = t ? [t.host] : await safeAddresses(mx, deps.allowPrivate); } catch (e) { last = { ...last, error: `${mx}: ${msgOf(e)}`, mxHost: mx }; continue; }
    if (!addrs.length) { last = { ok: false, permanent: false, response: null, error: `${mx} resolves to a private address and was skipped`, mxHost: mx }; continue; }
    for (const addr of addrs) {
      const transport = nodemailer.createTransport({
        host: addr, port: t?.port ?? deps.port ?? 25, secure: false, name: deps.helo, opportunisticTLS: true,
        // Opportunistic TLS between MTAs: encrypt when offered, accept the certificates MX hosts present.
        tls: { servername: mx, rejectUnauthorized: false },
        connectionTimeout: deps.timeoutMs ?? 20_000, greetingTimeout: deps.timeoutMs ?? 20_000, socketTimeout: 60_000,
        ...dkimOptions(m),
      } as unknown as SMTPTransport.Options);
      try {
        const info = await transport.sendMail(mailOptions(m)) as { response?: string };
        return { ok: true, permanent: false, response: info.response ?? null, error: null, mxHost: mx };
      } catch (e) {
        const code = codeOf(e);
        const resp = (e as { response?: string }).response ?? null;
        last = { ok: false, permanent: code != null && code >= 500, response: resp, error: `${mx}: ${msgOf(e)}`, mxHost: mx };
        if (last.permanent) return last;
      } finally { transport.close(); }
    }
  }
  return last;
}

export interface RelayDeps { allowPrivate: boolean; helo: string; timeoutMs?: number; /** Tests: connect here instead of resolving the relay host. */ target?: { host: string; port: number } }

/** Hand the message to an SMTP relay (provider or the installation's SMTP_URL parsed into the same shape). */
export async function deliverRelay(m: WireMessage, relay: RelayConfig, deps: RelayDeps): Promise<DeliveryResult> {
  let host = deps.target?.host ?? relay.host;
  if (!deps.target) {
    try { const a = await safeAddresses(relay.host, deps.allowPrivate); if (!a.length) return { ok: false, permanent: true, response: null, error: 'The relay host resolves to a private or loopback address', mxHost: relay.host }; host = a[0]!; } catch (e) {
      return { ok: false, permanent: false, response: null, error: `${relay.host}: ${msgOf(e)}`, mxHost: relay.host };
    }
  }
  const transport = nodemailer.createTransport({
    host, port: deps.target?.port ?? relay.port, secure: relay.security === 'tls', requireTLS: relay.security === 'starttls', ignoreTLS: relay.security === 'none', name: deps.helo,
    tls: { servername: relay.host },
    auth: relay.username ? { user: relay.username, pass: relay.password } : undefined,
    connectionTimeout: deps.timeoutMs ?? 20_000, greetingTimeout: deps.timeoutMs ?? 20_000, socketTimeout: 60_000,
    // A relay signs with its own keys; messages are signed here only when a key was given.
    ...dkimOptions(m),
  } as unknown as SMTPTransport.Options);
  try {
    const info = await transport.sendMail(mailOptions(m)) as { response?: string };
    return { ok: true, permanent: false, response: info.response ?? null, error: null, mxHost: relay.host };
  } catch (e) {
    const code = codeOf(e);
    const authFail = (e as { code?: string }).code === 'EAUTH';
    return { ok: false, permanent: authFail || (code != null && code >= 500), response: (e as { response?: string }).response ?? null, error: msgOf(e), mxHost: relay.host };
  } finally { transport.close(); }
}

/** The installation-wide SMTP account (`SMTP_URL`): the URL is the administrator's own configuration, so no host checks apply. */
export async function deliverEnv(m: WireMessage, smtpUrl: string): Promise<DeliveryResult> {
  const transport = nodemailer.createTransport(smtpUrl);
  try {
    const info = await transport.sendMail(mailOptions(m)) as { response?: string };
    return { ok: true, permanent: false, response: info.response ?? null, error: null, mxHost: null };
  } catch (e) {
    const code = codeOf(e);
    return { ok: false, permanent: (e as { code?: string }).code === 'EAUTH' || (code != null && code >= 500), response: (e as { response?: string }).response ?? null, error: msgOf(e), mxHost: null };
  } finally { transport.close(); }
}
