import { Resolver } from 'node:dns/promises';
import { BlockList, connect, isIP } from 'node:net';
import { dkimHost, dkimPublicKeyOf, dkimTxtValue } from './dkim';
import { isSpf, mergeSpf, spfCovers, spfTerms, type SpfAdd, type SpfMerge } from './spf';

/** The slice of a DNS resolver the e-mail checks use. Tests pass a mock; the server passes {@link systemResolver}. */
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
}

/** A resolver using the system's name servers (or `servers` when given). */
export function systemResolver(opts: { servers?: string[]; timeoutMs?: number; tries?: number } = {}): DnsResolver {
  const r = new Resolver({ timeout: opts.timeoutMs ?? 4000, tries: opts.tries ?? 2 });
  if (opts.servers) r.setServers(opts.servers);
  return r as unknown as DnsResolver;
}

export type CheckStatus = 'ok' | 'warn' | 'error' | 'unknown';
const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENOENT']);
const errCode = (e: unknown) => (e as { code?: string } | null)?.code ?? 'ERROR';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** TXT records of `name`, each joined from its chunks. `error` is set for failures other than "no such record". */
export async function lookupTxt(r: DnsResolver, name: string): Promise<{ records: string[]; error: string | null }> {
  try { return { records: (await r.resolveTxt(name)).map((c) => c.join('')), error: null }; } catch (e) {
    return NOT_FOUND.has(errCode(e)) ? { records: [], error: null } : { records: [], error: errText(e) };
  }
}
async function lookupCname(r: DnsResolver, name: string): Promise<string[]> {
  try { return await r.resolveCname(name); } catch { return []; }
}

export interface DnsRecord {
  id: 'spf' | 'dkim' | 'dmarc';
  type: 'TXT';
  /** Full host name to create the record at. */
  host: string;
  /** The value to publish (SPF: merged with an existing record when there is one). */
  value: string;
  /** SPF: the record found today, when there is one. */
  existing: string | null;
  /** SPF merge notes, as codes. */
  problems: SpfMerge['problems'];
}

export interface RecordsInput {
  domain: string;
  mode: 'direct' | 'relay';
  ip4: string[];
  ip6: string[];
  relayInclude: string | null;
  existingSpf: string[];
  dkim: { selector: string; publicKey: string } | null;
  dmarcReportEmail: string | null;
}

/** The DNS records to publish for a domain. */
export function buildRecords(i: RecordsInput): DnsRecord[] {
  const add: SpfAdd = i.mode === 'direct' ? { ip4: i.ip4, ip6: i.ip6 } : { include: i.relayInclude ? [i.relayInclude] : [] };
  const spf = mergeSpf(i.existingSpf, add);
  const out: DnsRecord[] = [{ id: 'spf', type: 'TXT', host: i.domain, value: spf.value, existing: i.existingSpf.find(isSpf) ?? null, problems: spf.problems }];
  if (i.mode === 'direct' && i.dkim) out.push({ id: 'dkim', type: 'TXT', host: dkimHost(i.dkim.selector, i.domain), value: dkimTxtValue(i.dkim.publicKey), existing: null, problems: [] });
  out.push({ id: 'dmarc', type: 'TXT', host: `_dmarc.${i.domain}`, value: dmarcValue(i.dmarcReportEmail ?? `postmaster@${i.domain}`), existing: null, problems: [] });
  return out;
}
export const dmarcValue = (rua: string) => `v=DMARC1; p=none; rua=mailto:${rua}`;

export interface RecordCheck {
  id: 'spf' | 'dkim' | 'dmarc';
  status: CheckStatus;
  /** What is wrong, as a code the UI translates. */
  code: string;
  host: string;
  /** What is published today (the first record found), if anything. */
  found: string | null;
  /** Extra detail: a resolver error, a CNAME target... */
  detail: string | null;
}

export interface CheckInput {
  resolver: DnsResolver;
  domain: string;
  mode: 'direct' | 'relay';
  ip4: string[];
  ip6: string[];
  relayInclude: string | null;
  /** Keys whose DNS record should exist (active first, then pending). */
  dkimKeys: Array<{ selector: string; publicKey: string; status: 'active' | 'pending' }>;
}

// ---- SPF evaluation (just enough to know whether our address is authorised) ----------------------------------------------------

async function spfAuthorises(r: DnsResolver, domain: string, ip: string, budget: { n: number }, depth = 0): Promise<boolean> {
  const { records } = await lookupTxt(r, domain);
  const rec = records.find(isSpf);
  if (!rec || depth > 5) return false;
  const kind = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
  for (const raw of spfTerms(rec)) {
    if (/^[-~?]/.test(raw)) continue; // only authorising terms (the default qualifier is +)
    const term = raw.replace(/^\+/, '');
    const m = /^(ip4|ip6):(.+)$/i.exec(term);
    if (m) {
      const [net, bits] = m[2]!.split('/');
      const list = new BlockList();
      try { list.addSubnet(net!, bits ? Number(bits) : (m[1]!.toLowerCase() === 'ip4' ? 32 : 128), m[1]!.toLowerCase() === 'ip4' ? 'ipv4' : 'ipv6'); if (list.check(ip, kind)) return true; } catch { /* malformed term */ }
      continue;
    }
    if (budget.n >= 10) break;
    const inc = /^include:(.+)$/i.exec(term);
    if (inc) { budget.n++; if (await spfAuthorises(r, inc[1]!, ip, budget, depth + 1)) return true; continue; }
    const a = /^a(?::([^/]+))?(?:\/\d+)?$/i.exec(term);
    if (a) { budget.n++; try { if ((kind === 'ipv4' ? await r.resolve4(a[1] ?? domain) : await r.resolve6(a[1] ?? domain)).includes(ip)) return true; } catch { /* none */ } continue; }
    const mx = /^mx(?::([^/]+))?(?:\/\d+)?$/i.exec(term);
    if (mx) {
      budget.n++;
      try { for (const h of await r.resolveMx(mx[1] ?? domain)) { if ((kind === 'ipv4' ? await r.resolve4(h.exchange).catch(() => []) : await r.resolve6(h.exchange).catch(() => [])).includes(ip)) return true; } } catch { /* none */ }
    }
  }
  return false;
}

/** Live DNS check of the three records of a domain. */
export async function checkDomainDns(i: CheckInput): Promise<RecordCheck[]> {
  const { resolver: r, domain } = i;
  const out: RecordCheck[] = [];

  // SPF
  const spfTxt = await lookupTxt(r, domain);
  const spfs = spfTxt.records.filter(isSpf);
  const spfBase = { id: 'spf' as const, host: domain, found: spfs[0] ?? null };
  if (spfTxt.error) out.push({ ...spfBase, status: 'unknown', code: 'lookup_error', detail: spfTxt.error });
  else if (!spfs.length) out.push({ ...spfBase, status: i.mode === 'direct' ? 'error' : 'warn', code: 'missing', detail: null });
  else if (spfs.length > 1) out.push({ ...spfBase, status: 'error', code: 'multiple', detail: String(spfs.length) });
  else if (i.mode === 'direct') {
    const ips = [...i.ip4, ...i.ip6];
    if (!ips.length) out.push({ ...spfBase, status: 'unknown', code: 'no_ip', detail: null });
    else {
      const budget = { n: 0 };
      const results = await Promise.all(ips.map((ip) => spfAuthorises(r, domain, ip, budget)));
      const q = spfTerms(spfs[0]!).find((t) => /^[+\-~?]?all$/i.test(t));
      if (!results.every(Boolean)) out.push({ ...spfBase, status: 'error', code: 'ip_missing', detail: ips.filter((_, k) => !results[k]).join(', ') });
      else if (q === 'all' || q === '+all' || q === '?all') out.push({ ...spfBase, status: 'warn', code: 'permissive', detail: null });
      else out.push({ ...spfBase, status: 'ok', code: 'ok', detail: null });
    }
  } else if (i.relayInclude) {
    out.push({ ...spfBase, status: spfCovers(spfs[0]!, { include: [i.relayInclude] }) ? 'ok' : 'warn', code: spfCovers(spfs[0]!, { include: [i.relayInclude] }) ? 'ok' : 'include_missing', detail: i.relayInclude });
  } else out.push({ ...spfBase, status: 'ok', code: 'relay_no_include', detail: null });

  // DKIM
  if (i.mode === 'relay') {
    out.push({ id: 'dkim', status: 'unknown', code: 'relay', host: domain, found: null, detail: null });
  } else if (!i.dkimKeys.length) {
    out.push({ id: 'dkim', status: 'error', code: 'no_key', host: domain, found: null, detail: null });
  } else {
    const key = i.dkimKeys[0]!;
    const host = dkimHost(key.selector, domain);
    const t = await lookupTxt(r, host);
    const base = { id: 'dkim' as const, host, found: t.records[0] ?? null };
    const pub = (t.records.map(dkimPublicKeyOf).find((p) => p != null) ?? null);
    if (t.error) out.push({ ...base, status: 'unknown', code: 'lookup_error', detail: t.error });
    else if (pub === key.publicKey) out.push({ ...base, status: 'ok', code: 'ok', detail: null });
    else if (pub === '') out.push({ ...base, status: 'error', code: 'revoked', detail: null });
    else if (pub) out.push({ ...base, status: 'error', code: 'mismatch', detail: null });
    else {
      const cn = await lookupCname(r, host);
      out.push(cn.length ? { ...base, status: 'warn', code: 'cname', detail: cn[0]! } : { ...base, status: 'error', code: 'missing', detail: null });
    }
  }

  // DMARC
  const dm = await lookupTxt(r, `_dmarc.${domain}`);
  const rec = dm.records.find((x) => /^v=DMARC1\b/i.test(x.trim()));
  const dmBase = { id: 'dmarc' as const, host: `_dmarc.${domain}`, found: rec ?? null };
  if (dm.error) out.push({ ...dmBase, status: 'unknown', code: 'lookup_error', detail: dm.error });
  else if (!rec) out.push({ ...dmBase, status: 'warn', code: 'missing', detail: null });
  else {
    const tags = new Map(rec.split(';').map((p) => { const k = p.indexOf('='); return [p.slice(0, k < 0 ? undefined : k).trim().toLowerCase(), k < 0 ? '' : p.slice(k + 1).trim()] as const; }));
    const p = (tags.get('p') ?? '').toLowerCase();
    if (!['none', 'quarantine', 'reject'].includes(p)) out.push({ ...dmBase, status: 'warn', code: 'invalid', detail: null });
    else out.push({ ...dmBase, status: 'ok', code: p === 'none' ? (tags.get('rua') ? 'monitor' : 'monitor_no_rua') : 'enforced', detail: null });
  }
  return out;
}

/** SPF and DKIM pass (direct mode): what lets a store send From its own address. */
export const recordsAuthenticated = (checks: RecordCheck[]) => ['spf', 'dkim'].every((id) => checks.find((c) => c.id === id)?.status === 'ok');

// ---- server checks (direct mode) -----------------------------------------------------------------------------------------------

export interface ServerCheck {
  id: 'port25' | 'ptr' | 'dnsbl' | 'ip';
  status: CheckStatus;
  code: string;
  /** Machine data for the explanation (hosts, listed zones, names...). */
  data: Record<string, unknown>;
}

export type TcpProbe = (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; banner?: string; error?: string }>;

/** Connect to host:port and read the first line (the SMTP greeting). */
export const tcpProbe: TcpProbe = (host, port, timeoutMs) => new Promise((resolve) => {
  const s = connect({ host, port });
  let done = false; let buf = '';
  const end = (v: { ok: boolean; banner?: string; error?: string }) => { if (done) return; done = true; s.destroy(); resolve(v); };
  s.setTimeout(timeoutMs, () => end({ ok: false, error: 'timeout' }));
  s.on('error', (e) => end({ ok: false, error: (e as { code?: string }).code ?? e.message }));
  s.on('data', (d) => { buf += d.toString('utf8'); if (buf.includes('\n')) end({ ok: /^220/.test(buf), banner: buf.split(/\r?\n/)[0]!.slice(0, 120), error: /^220/.test(buf) ? undefined : 'no-greeting' }); });
  s.on('close', () => end({ ok: false, error: 'closed' }));
});

/** Well-known providers whose MX hosts are used to test that outbound port 25 is open. */
export const PORT25_PROBE_DOMAINS = ['gmail.com', 'outlook.com'];
/** DNS blocklists queried (A records, IPv4 only). Queries are made only on demand and cached; a list that refuses resolver queries is "unknown". */
export const DNSBL_ZONES = ['zen.spamhaus.org', 'bl.spamcop.net', 'psbl.surriel.com'];

export const reverseIp4 = (ip: string) => ip.split('.').reverse().join('.');

async function checkPort25(r: DnsResolver, probe: TcpProbe): Promise<ServerCheck> {
  const tried: Array<{ host: string; error?: string }> = [];
  for (const d of PORT25_PROBE_DOMAINS) {
    let hosts: string[] = [];
    try { hosts = (await r.resolveMx(d)).sort((a, b) => a.priority - b.priority).slice(0, 1).map((m) => m.exchange); } catch { /* try next */ }
    for (const host of hosts) {
      const res = await probe(host, 25, 5000);
      if (res.ok) return { id: 'port25', status: 'ok', code: 'ok', data: { host, banner: res.banner ?? null } };
      tried.push({ host, error: res.error });
    }
  }
  if (!tried.length) return { id: 'port25', status: 'unknown', code: 'no_dns', data: {} };
  return { id: 'port25', status: 'error', code: tried.every((t) => t.error === 'timeout') ? 'timeout' : 'blocked', data: { tried } };
}

const GENERIC_PTR = /(\d{1,3}[-.]\d{1,3}[-.]\d{1,3}[-.]\d{1,3})|ip-\d|static|dynamic|dhcp|pool|cust/i;
async function checkPtr(r: DnsResolver, ip: string): Promise<ServerCheck> {
  let names: string[] = [];
  try { names = await r.reverse(ip); } catch (e) { if (!NOT_FOUND.has(errCode(e))) return { id: 'ptr', status: 'unknown', code: 'lookup_error', data: { error: errText(e) } }; }
  if (!names.length) return { id: 'ptr', status: 'error', code: 'missing', data: { ip } };
  for (const name of names) {
    let addrs: string[] = [];
    try { addrs = isIP(ip) === 6 ? await r.resolve6(name) : await r.resolve4(name); } catch { /* not resolvable */ }
    if (addrs.includes(ip)) return { id: 'ptr', status: GENERIC_PTR.test(name) ? 'warn' : 'ok', code: GENERIC_PTR.test(name) ? 'generic' : 'ok', data: { ip, name } };
  }
  return { id: 'ptr', status: 'warn', code: 'not_confirmed', data: { ip, names } };
}

const cache = new Map<string, { at: number; value: ServerCheck }>();
export const clearDnsblCache = () => cache.clear();
async function checkDnsbl(r: DnsResolver, ip: string, now: number): Promise<ServerCheck> {
  const hit = cache.get(ip);
  if (hit && now - hit.at < 3_600_000) return hit.value;
  if (isIP(ip) !== 4) return { id: 'dnsbl', status: 'unknown', code: 'ipv6', data: {} };
  const listed: Array<{ zone: string; code: string }> = []; const unknown: string[] = []; const clean: string[] = [];
  for (const zone of DNSBL_ZONES) {
    try {
      const a = await r.resolve4(`${reverseIp4(ip)}.${zone}`);
      if (a.some((x) => x.startsWith('127.255.255.'))) unknown.push(zone); // the list refused this resolver
      else listed.push({ zone, code: a[0] ?? '' });
    } catch (e) { if (NOT_FOUND.has(errCode(e))) clean.push(zone); else unknown.push(zone); }
  }
  const value: ServerCheck = listed.length ? { id: 'dnsbl', status: 'error', code: 'listed', data: { listed, unknown } }
    : clean.length ? { id: 'dnsbl', status: 'ok', code: 'ok', data: { clean, unknown } }
    : { id: 'dnsbl', status: 'unknown', code: 'refused', data: { unknown } };
  if (value.status !== 'unknown') cache.set(ip, { at: now, value });
  return value;
}

export interface PublicIp { v4: string | null; v6: string | null; source: 'config' | 'dns' | 'manual' | null }

/** Parse `PUBLIC_IP` / a typed address: one or two (IPv4, IPv6) literals, comma separated. */
export function parsePublicIp(v: string | null | undefined): { v4: string | null; v6: string | null } {
  const out = { v4: null as string | null, v6: null as string | null };
  for (const p of (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)) { const k = isIP(p); if (k === 4) out.v4 ??= p; else if (k === 6) out.v6 ??= p; }
  return out;
}

let ipCache: { at: number; v: { v4: string | null; v6: string | null } } | null = null;
/** The server's public address as seen from outside: asked of public DNS "what is my IP" services (no HTTP). Cached for 10 minutes. */
export async function detectPublicIpViaDns(now = Date.now()): Promise<{ v4: string | null; v6: string | null }> {
  if (ipCache && now - ipCache.at < 600_000) return ipCache.v;
  const v: { v4: string | null; v6: string | null } = { v4: null, v6: null };
  try { v.v4 = (await systemResolver({ servers: ['208.67.222.222'], timeoutMs: 2500, tries: 1 }).resolve4('myip.opendns.com'))[0] ?? null; } catch { /* next */ }
  if (!v.v4) {
    try { const t = (await systemResolver({ servers: ['216.239.32.10'], timeoutMs: 2500, tries: 1 }).resolveTxt('o-o.myaddr.l.google.com')).flat().map((s) => s.trim()).find((s) => isIP(s) === 4); v.v4 = t ?? null; } catch { /* none */ }
  }
  try { v.v6 = (await systemResolver({ servers: ['2620:119:35::35'], timeoutMs: 2000, tries: 1 }).resolve6('myip.opendns.com'))[0] ?? null; } catch { /* no IPv6 */ }
  ipCache = { at: now, v };
  return v;
}
export const clearIpCache = () => { ipCache = null; };

/** The four server checks of direct delivery. `ip` is the IPv4 (or IPv6) the server sends from; null when it is unknown. */
export async function runServerChecks(o: { resolver: DnsResolver; probe?: TcpProbe; ip: string | null; now?: number }): Promise<ServerCheck[]> {
  const probe = o.probe ?? tcpProbe;
  const ipCheck: ServerCheck = o.ip ? { id: 'ip', status: 'ok', code: 'ok', data: { ip: o.ip } } : { id: 'ip', status: 'unknown', code: 'unknown', data: {} };
  const [p25, ptr, bl] = await Promise.all([checkPort25(o.resolver, probe), o.ip ? checkPtr(o.resolver, o.ip) : Promise.resolve<ServerCheck>({ id: 'ptr', status: 'unknown', code: 'no_ip', data: {} }), o.ip ? checkDnsbl(o.resolver, o.ip, o.now ?? Date.now()) : Promise.resolve<ServerCheck>({ id: 'dnsbl', status: 'unknown', code: 'no_ip', data: {} })]);
  return [ipCheck, p25, ptr, bl];
}
