import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import {
  EMAIL_RETRY_DELAYS_MS, RELAY_PRESETS, activateDkimKey, buildRecords, checkDomainDns, claimOutbox, decideFrom, deliverDirect, deliverEnv, deliverRelay, detectPublicIpViaDns, dkimHost, dkimTxtValue,
  dueOutboxIds, encryptRelayPassword, ensureActiveKey, getEmailSettings, getPrimaryShop, getShop, insertOutbox, isFreeMailboxDomain, isHostname, isLocalDomain, isPrivateAddress, isSpf, isValidRelayHost,
  listDkimKeys, listOutbox, lookupTxt, notificationSettingsOf, parseMailAddress, parsePublicIp, purgeOutbox, recentFailureCount, recordAttempt, recordsAuthenticated, relayOf, relayPreset, resolvesToPrivate,
  rotateDkimKey, runServerChecks, saveEmailSettings, schema as s, sendingDomainOf, signingKey, systemResolver, tcpProbe, updateEmailMarketingConsent,
  type DeliveryResult, type DnsRecord, type DnsResolver, type DirectDeps, type EmailMode, type EmailScope, type EmailSettingsRow, type FromDecision, type Mail, type OutboxPayload, type OutboxRow,
  type RecordCheck, type ServerCheck, type Shop, type TcpProbe, type WireMessage,
} from '@shopme/core';
import type { AppContext } from '../context';
import { FailureLimiter } from '../plugins/rate-limit';

/** Everything the e-mail code reaches the network through. Tests replace these; the defaults are the real thing. */
export interface EmailDeps {
  resolver: DnsResolver;
  probe: TcpProbe;
  detectIp(): Promise<{ v4: string | null; v6: string | null }>;
  /** Port, host mapping and timeouts of direct delivery. `allowPrivate` is taken from the configuration. */
  direct: Partial<Omit<DirectDeps, 'resolver' | 'allowPrivate' | 'helo'>>;
  /** Tests: connect relays here. */
  relayTarget?: { host: string; port: number };
}

export interface SenderInfo { address: string | null; domain: string | null; source: 'sender' | 'derived' | null; free: boolean }
export interface LastCheck { at: string; mode: 'direct' | 'relay'; domain: string | null; records: RecordCheck[]; server: ServerCheck[] | null; ip: { v4: string | null; v6: string | null; source: string | null } }
export interface EmailHealth { status: 'ok' | 'unchecked' | 'problem'; reasons: string[]; effectiveMode: EmailMode; fromKind: 'store' | 'platform'; /** The store sends with its own domain authenticated (or through a relay): the "set up your e-mails" step is done. */ done: boolean }
export interface TestResult { ok: boolean; status: string; response: string | null; error: string | null; messageId: string; mode: EmailMode; mxHost: string | null; from: string; to: string }

export type EmailInput = {
  mode?: 'direct' | 'relay' | null; preset?: string | null; host?: string | null; port?: number | null; security?: string | null; username?: string | null; password?: string | null; clearPassword?: boolean | null;
  manualPublicIp?: string | null; dmarcReportEmail?: string | null;
};
export type FieldError = { field: string[]; message: string };

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const splitRecipients = (v: string) => v.split(/[,;]/).map((x) => parseMailAddress(x).address).filter((x) => EMAIL_RE.test(x));
const quote = (name: string) => `"${name.replace(/["\\\r\n]/g, '')}"`;
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export class EmailService {
  deps: EmailDeps = {
    resolver: systemResolver(), probe: tcpProbe, detectIp: () => detectPublicIpViaDns(), direct: {},
  };
  /** Test e-mails: 5 per 10 minutes per store (and per platform). */
  private testLimiter = new FailureLimiter(5, 10 * 60_000);
  constructor(private ctx: AppContext) {}
  /** Counts a test send against the limit; returns the seconds to wait when the limit is reached, else 0. */
  testRateLimit(scope: EmailScope): number {
    const key = `test:${scope ?? 'platform'}`;
    if (this.testLimiter.isLimited(key)) return this.testLimiter.retryAfter(key);
    this.testLimiter.fail(key);
    return 0;
  }

  private get db() { return this.ctx.db; }
  private get config() { return this.ctx.config; }
  private get secret() { return this.config.sessionSecret; }

  // ---- identity ----------------------------------------------------------------------------------------------------------------

  /** Domain of the installation's own sending identity (the fallback From), or null when it has no real domain. */
  platformDomain(): string | null {
    const c = this.config;
    const cands = c.multiStore ? [c.storeBaseDomain, ...c.adminHosts] : [new URL(c.appUrl).hostname];
    return cands.map((d) => d.toLowerCase()).find((d) => isHostname(d) && !isLocalDomain(d)) ?? null;
  }
  platformAddress(): string | null { const d = this.platformDomain(); return d ? `no-reply@${d}` : null; }

  /** The store's sender: the address set in Settings > Notifications, else `no-reply@` on the store's own domain (primary domain, then the APP_URL host in single-store mode). */
  senderOf(shop: Shop): SenderInfo {
    const explicit = notificationSettingsOf(shop).senderEmail.trim();
    if (explicit) { const domain = sendingDomainOf(explicit); return { address: explicit, domain, source: 'sender', free: isFreeMailboxDomain(domain) }; }
    const cands = [shop.primaryDomain, ...(this.config.multiStore ? [] : [new URL(this.config.appUrl).hostname])].map((d) => d?.toLowerCase().trim() ?? '');
    const domain = cands.find((d) => isHostname(d) && !isLocalDomain(d)) ?? null;
    return { address: domain ? `no-reply@${domain}` : null, domain, source: domain ? 'derived' : null, free: false };
  }

  private async shopOf(scope: EmailScope): Promise<Shop | null> { return scope == null ? null : getShop(this.db, scope); }

  /** The domain a scope signs for: the store's sender domain, or the platform domain. */
  async domainOf(scope: EmailScope): Promise<string | null> {
    if (scope == null) return this.platformDomain();
    const shop = await this.shopOf(scope);
    return shop ? this.senderOf(shop).domain : null;
  }

  async publicIp(row: EmailSettingsRow | null): Promise<{ v4: string | null; v6: string | null; source: 'config' | 'dns' | 'manual' | null }> {
    const cfg = parsePublicIp(this.config.publicIp);
    if (cfg.v4 || cfg.v6) return { ...cfg, source: 'config' };
    let det: { v4: string | null; v6: string | null } = { v4: null, v6: null };
    try { det = await this.deps.detectIp(); } catch { /* fall through to the typed address */ }
    if (det.v4 || det.v6) return { ...det, source: 'dns' };
    const man = parsePublicIp(row?.manualPublicIp);
    return man.v4 || man.v6 ? { ...man, source: 'manual' } : { v4: null, v6: null, source: null };
  }

  // ---- mode and From -----------------------------------------------------------------------------------------------------------

  /** `relay`: the store's relay; `env`: the installation's SMTP_URL; `direct`: this server; `log`: nothing configured and not allowed to send (tests). */
  async modeOf(scope: EmailScope): Promise<{ mode: EmailMode; configured: 'direct' | 'relay' | null; row: EmailSettingsRow | null }> {
    const row = await getEmailSettings(this.db, scope);
    const configured = (row?.mode === 'relay' || row?.mode === 'direct' ? row.mode : null);
    if (configured === 'relay' && relayOf(row, this.secret)) return { mode: 'relay', configured, row };
    if (configured === 'direct') return { mode: 'direct', configured, row };
    if (this.config.smtpUrl) return { mode: 'env', configured, row };
    return { mode: this.config.env === 'test' ? 'log' : 'direct', configured, row };
  }

  async platformAuth(): Promise<{ domain: string | null; address: string | null; authenticated: boolean }> {
    const domain = this.platformDomain();
    if (!domain) return { domain: null, address: null, authenticated: false };
    const row = await getEmailSettings(this.db, null);
    return { domain, address: `no-reply@${domain}`, authenticated: !!row?.authOk && row.authDomain === domain };
  }

  async fromDecision(shop: Shop, mode: EmailMode, row: EmailSettingsRow | null): Promise<FromDecision & { storeAddress: string | null }> {
    const sender = this.senderOf(shop);
    const p = await this.platformAuth();
    const d = decideFrom({
      mode, storeAddress: sender.address, storeAuthenticated: !!row?.authOk && !!sender.domain && row.authDomain === sender.domain,
      platform: p.address ? { address: p.address, authenticated: p.authenticated } : null, defaultAddress: parseMailAddress(this.config.mailFrom).address,
    });
    return { ...d, storeAddress: sender.address };
  }

  // ---- sending -----------------------------------------------------------------------------------------------------------------

  private unsubscribeToken(shopId: number, email: string) {
    const body = Buffer.from(`${shopId}:${email.toLowerCase()}`).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret).update(`unsub:${body}`).digest('base64url')}`;
  }
  /** Shop id and e-mail from a token made by this server, or null. */
  readUnsubscribeToken(token: string): { shopId: number; email: string } | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const want = createHmac('sha256', this.secret).update(`unsub:${body}`).digest('base64url');
    if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
    const [id, ...rest] = Buffer.from(body, 'base64url').toString('utf8').split(':');
    const shopId = Number(id);
    return Number.isSafeInteger(shopId) && rest.length ? { shopId, email: rest.join(':') } : null;
  }

  private heloName(domain: string | null) {
    const h = new URL(this.config.appUrl).hostname;
    return isHostname(h) && !isLocalDomain(h) ? h : (domain ?? osHostname());
  }

  /** The mailer the rest of the server uses: every message goes to the outbox and is delivered in the background. */
  mailer() {
    return { send: (mail: Mail) => this.send(mail) };
  }

  private async prepare(mail: Mail, shop: Shop | null, mode: EmailMode, row: EmailSettingsRow | null, to: string): Promise<{ payload: OutboxPayload; messageId: string; from: string }> {
    const platformFrom = parseMailAddress(this.config.mailFrom);
    const given = mail.from ? parseMailAddress(mail.from) : null;
    const name = given?.name ?? mail.fromName ?? shop?.name ?? platformFrom.name ?? null;
    let fromAddress: string; let replyTo = mail.replyTo; let signScope: EmailScope = shop?.id ?? null;
    if (mode === 'env' && this.config.multiStore) {
      // The installation's SMTP account authenticates for the platform address only: the store is the display name and the Reply-To.
      fromAddress = platformFrom.address;
      if (given && given.address.toLowerCase() !== platformFrom.address.toLowerCase()) replyTo ??= given.address;
    } else if (shop) {
      const d = await this.fromDecision(shop, mode, row);
      fromAddress = d.address;
      if (d.kind === 'platform') { signScope = null; replyTo ??= d.storeAddress ?? shop.email ?? undefined; }
    } else { fromAddress = given?.address ?? platformFrom.address; signScope = null; }
    const domain = sendingDomainOf(fromAddress);
    const messageId = `<${randomUUID()}@${domain ?? this.heloName(null)}>`;
    const payload: OutboxPayload = {
      from: name ? `${quote(name)} <${fromAddress}>` : fromAddress, to, replyTo, subject: mail.subject, text: mail.text, html: mail.html, envelopeFrom: fromAddress,
      dkim: mode === 'direct' && domain ? { domain, scope: signScope } : null,
    };
    if (mail.marketing && shop) {
      const urls: string[] = [];
      const base = this.ctx.stores.storefrontBase(shop.id);
      urls.push(`${base}/unsubscribe/${this.unsubscribeToken(shop.id, to)}`);
      const box = replyTo ?? shop.email;
      if (box) urls.push(`mailto:${parseMailAddress(box).address}?subject=unsubscribe`);
      payload.list = { unsubscribe: urls, oneClick: base.startsWith('https://') };
    }
    return { payload, messageId, from: fromAddress };
  }

  /** Queue a message: one outbox row per recipient, delivered in the background (retries for temporary failures). */
  async send(mail: Mail): Promise<void> {
    const shopId = mail.shopId ?? (this.config.multiStore ? null : (await getPrimaryShop(this.db))?.id ?? null);
    const shop = shopId == null ? null : await getShop(this.db, shopId);
    const { mode, row } = await this.modeOf(shop?.id ?? null);
    if (mode === 'log') { this.ctx.log.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'email (no sending mode configured, not sent)'); return; }
    for (const to of splitRecipients(mail.to)) {
      const p = await this.prepare(mail, shop, mode, row, to);
      const id = await insertOutbox(this.db, { shopId: shop?.id ?? null, messageId: p.messageId, to, from: p.from, subject: mail.subject, mode, payload: p.payload });
      this.ctx.queue.enqueue('email.deliver', { id }, { maxAttempts: 1 });
    }
  }

  /** One delivery attempt of an outbox row (claimed first, so two workers never send twice). */
  async deliver(id: number, opts: { retry?: boolean; now?: Date } = {}): Promise<{ status: OutboxRow['status']; result: DeliveryResult } | null> {
    const row = await claimOutbox(this.db, id, opts.now);
    if (!row) return null;
    const payload = row.payload as OutboxPayload | null;
    const fail = (error: string): DeliveryResult => ({ ok: false, permanent: true, response: null, error, mxHost: null });
    let result: DeliveryResult;
    try {
      if (!payload) result = fail('The message is no longer available');
      else {
        const wire: WireMessage = { messageId: row.messageId, from: payload.from, envelopeFrom: payload.envelopeFrom, to: payload.to, replyTo: payload.replyTo, subject: payload.subject, text: payload.text, html: payload.html, list: payload.list };
        const helo = this.heloName(sendingDomainOf(payload.envelopeFrom));
        if (row.mode === 'direct') {
          if (payload.dkim) { const k = await signingKey(this.db, payload.dkim.scope, payload.dkim.domain, this.secret); if (k) wire.dkim = { domain: payload.dkim.domain, selector: k.selector, privateKey: k.privateKey }; }
          result = await deliverDirect(wire, { resolver: this.deps.resolver, allowPrivate: this.config.emailAllowPrivateHosts, helo, ...this.deps.direct });
        } else if (row.mode === 'relay') {
          const cfg = relayOf(await getEmailSettings(this.db, row.shopId), this.secret);
          result = cfg ? await deliverRelay(wire, cfg, { allowPrivate: this.config.emailAllowPrivateHosts, helo, target: this.deps.relayTarget }) : fail('The relay is not configured');
        } else {
          result = this.config.smtpUrl ? await deliverEnv(wire, this.config.smtpUrl) : fail('SMTP_URL is not set');
        }
      }
    } catch (e) {
      result = { ok: false, permanent: false, response: null, error: errMessage(e), mxHost: null };
    }
    const status = await recordAttempt(this.db, row, result, { retry: opts.retry, now: opts.now });
    if (status === 'failed') this.ctx.log.warn({ outboxId: id, mode: row.mode, error: result.error }, 'email delivery failed');
    return { status, result };
  }

  /** Background sweep: deliver rows whose time has come (new rows are delivered at once through the queue; this is the retry clock and the crash recovery). */
  async sweep(now = new Date()): Promise<number> {
    const ids = await dueOutboxIds(this.db, now);
    for (const id of ids) await this.deliver(id, { now });
    return ids.length;
  }

  /** Send a test e-mail and wait for the outcome (one attempt, no retries). */
  async sendTest(scope: EmailScope, to: string): Promise<TestResult> {
    const shop = await this.shopOf(scope);
    const { mode, row } = await this.modeOf(scope);
    const fr = (shop?.locale ?? 'en').toLowerCase().startsWith('fr');
    const name = shop?.name ?? 'ShopMe';
    const mail: Mail = {
      to, shopId: shop?.id, fromName: name, from: shop ? this.senderOf(shop).address ?? undefined : undefined,
      subject: fr ? `E-mail de test de ${name}` : `Test e-mail from ${name}`,
      text: fr ? `Bonne nouvelle : si vous lisez ce message, votre boutique ${name} sait envoyer des e-mails.` : `Good news: if you can read this, your store ${name} can send e-mail.`,
      html: fr ? `<p>Bonne nouvelle : si vous lisez ce message, votre boutique <strong>${name.replace(/[<>&]/g, '')}</strong> sait envoyer des e-mails.</p>` : `<p>Good news: if you can read this, your store <strong>${name.replace(/[<>&]/g, '')}</strong> can send e-mail.</p>`,
    };
    if (mode === 'log') return { ok: false, status: 'failed', response: null, error: 'no_mode', messageId: '', mode, mxHost: null, from: '', to };
    const p = await this.prepare(mail, shop, mode, row, to);
    const id = await insertOutbox(this.db, { shopId: shop?.id ?? null, messageId: p.messageId, to, from: p.from, subject: mail.subject, mode, payload: p.payload });
    const r = await this.deliver(id, { retry: false });
    const res = r?.result;
    return { ok: !!res?.ok, status: r?.status ?? 'failed', response: res?.response ?? null, error: res?.error ?? null, messageId: p.messageId, mode, mxHost: res?.mxHost ?? null, from: p.from, to };
  }

  // ---- settings ----------------------------------------------------------------------------------------------------------------

  async updateSettings(scope: EmailScope, i: EmailInput): Promise<{ errors: FieldError[] } | { ok: true }> {
    const errors: FieldError[] = [];
    const cur = await getEmailSettings(this.db, scope);
    const patch: Parameters<typeof saveEmailSettings>[2] = {};
    if (i.preset !== undefined) {
      if (i.preset && !relayPreset(i.preset)) errors.push({ field: ['preset'], message: 'Unknown relay preset' });
      else patch.relayPreset = i.preset || null;
    }
    if (i.host !== undefined) {
      const h = (i.host ?? '').trim().toLowerCase();
      if (!h) patch.relayHost = null;
      else if (!isValidRelayHost(h)) errors.push({ field: ['host'], message: 'Enter a host name such as smtp.example.com' });
      else if (!this.config.emailAllowPrivateHosts && (isIP(h) ? isPrivateAddress(h) : await resolvesToPrivate(h))) errors.push({ field: ['host'], message: 'This host is on a private or loopback network and cannot be used' });
      else patch.relayHost = h;
    }
    if (i.port !== undefined) {
      if (i.port == null) patch.relayPort = null;
      else if (!Number.isInteger(i.port) || i.port < 1 || i.port > 65535) errors.push({ field: ['port'], message: 'The port is a number between 1 and 65535' });
      else patch.relayPort = i.port;
    }
    if (i.security !== undefined) {
      if (i.security && !['tls', 'starttls', 'none'].includes(i.security)) errors.push({ field: ['security'], message: 'Choose TLS, STARTTLS or none' });
      else patch.relaySecurity = i.security || null;
    }
    if (i.username !== undefined) patch.relayUsername = (i.username ?? '').trim().slice(0, 200) || null;
    if (i.clearPassword) patch.relayPasswordEnc = null;
    else if (i.password) patch.relayPasswordEnc = encryptRelayPassword(i.password.slice(0, 500), this.secret);
    if (i.manualPublicIp !== undefined) {
      const v = (i.manualPublicIp ?? '').trim();
      const p = parsePublicIp(v);
      if (v && !p.v4 && !p.v6) errors.push({ field: ['manualPublicIp'], message: 'Enter an IPv4 or IPv6 address' });
      else patch.manualPublicIp = v || null;
    }
    if (i.dmarcReportEmail !== undefined) {
      const v = (i.dmarcReportEmail ?? '').trim();
      if (v && !EMAIL_RE.test(v)) errors.push({ field: ['dmarcReportEmail'], message: 'Enter a valid e-mail address' });
      else patch.dmarcReportEmail = v || null;
    }
    if (i.mode !== undefined) {
      if (i.mode === 'relay') {
        const host = patch.relayHost !== undefined ? patch.relayHost : cur?.relayHost;
        const port = patch.relayPort !== undefined ? patch.relayPort : cur?.relayPort;
        if (!host || !port) errors.push({ field: ['mode'], message: 'Fill in the relay host and port first' });
      }
      patch.mode = i.mode;
    }
    if (errors.length) return { errors };
    await saveEmailSettings(this.db, scope, patch);
    return { ok: true };
  }

  // ---- views -------------------------------------------------------------------------------------------------------------------

  async view(scope: EmailScope) {
    const shop = await this.shopOf(scope);
    const { mode, configured, row } = await this.modeOf(scope);
    const sender: SenderInfo = shop ? this.senderOf(shop) : { address: this.platformAddress(), domain: this.platformDomain(), source: null, free: false };
    const from = shop ? await this.fromDecision(shop, mode, row) : null;
    const plat = await this.platformAuth();
    const last = (row?.lastCheck ?? null) as LastCheck | null;
    const bad = (id: string) => last?.server?.find((c) => c.id === id)?.status === 'error';
    const relay = relayOf(row, this.secret);
    return {
      scope: scope == null ? 'platform' : 'store',
      configuredMode: configured, effectiveMode: mode,
      sender, sendingDomain: sender.domain,
      relay: { preset: row?.relayPreset ?? null, host: row?.relayHost ?? '', port: row?.relayPort ?? null, security: row?.relaySecurity ?? 'starttls', username: row?.relayUsername ?? '', passwordSet: !!relay?.password, configured: !!relay },
      relayPresets: RELAY_PRESETS,
      manualPublicIp: row?.manualPublicIp ?? '', dmarcReportEmail: row?.dmarcReportEmail ?? '', publicIpFromConfig: !!this.config.publicIp,
      envFallback: !!this.config.smtpUrl,
      from: from ? { kind: from.kind, address: from.address, reason: from.reason, deliverable: from.deliverable, storeAddress: from.storeAddress } : null,
      platform: scope == null ? null : { domain: plat.domain, address: plat.address, authenticated: plat.authenticated },
      multiStore: this.config.multiStore,
      auth: { ok: !!row?.authOk, domain: row?.authDomain ?? null, checkedAt: row?.authCheckedAt?.toISOString() ?? null },
      lastCheck: last,
      recommendRelay: bad('port25') || bad('dnsbl'),
    };
  }

  /** The DNS records to publish, merged with the SPF record already there. Creates the DKIM key the first time. */
  async records(scope: EmailScope) {
    const domain = await this.domainOf(scope);
    const { configured, row } = await this.modeOf(scope);
    const mode: 'direct' | 'relay' = configured === 'relay' ? 'relay' : 'direct';
    const ip = await this.publicIp(row);
    if (!domain) return { domain: null, mode, ip, records: [] as DnsRecord[], dkim: null, pending: null };
    const keys = mode === 'direct' ? await this.ensureKeys(scope, domain) : await listDkimKeys(this.db, scope, domain);
    const active = keys.find((k) => k.status === 'active') ?? null;
    const pending = keys.find((k) => k.status === 'pending') ?? null;
    const existingSpf = (await lookupTxt(this.deps.resolver, domain)).records.filter(isSpf);
    const include = relayPreset(row?.relayPreset)?.spfInclude ?? null;
    const records = buildRecords({ domain, mode, ip4: ip.v4 ? [ip.v4] : [], ip6: ip.v6 ? [ip.v6] : [], relayInclude: include, existingSpf, dkim: active ? { selector: active.selector, publicKey: active.publicKey } : null, dmarcReportEmail: row?.dmarcReportEmail ?? null });
    const keyView = (k: typeof active) => k ? { selector: k.selector, host: dkimHost(k.selector, domain), value: dkimTxtValue(k.publicKey) } : null;
    return { domain, mode, ip, records, dkim: keyView(active), pending: keyView(pending), relayInclude: include };
  }

  private async ensureKeys(scope: EmailScope, domain: string) {
    await ensureActiveKey(this.db, scope, domain, this.secret);
    return listDkimKeys(this.db, scope, domain);
  }

  /** Run the live checks and keep the outcome (it drives the From decision and the banner). `server: false` skips the slow server checks (background re-checks). */
  async check(scope: EmailScope, opts: { server?: boolean } = {}): Promise<LastCheck> {
    const domain = await this.domainOf(scope);
    const { configured, row } = await this.modeOf(scope);
    const mode: 'direct' | 'relay' = configured === 'relay' ? 'relay' : 'direct';
    const ip = await this.publicIp(row);
    let records: RecordCheck[] = [];
    if (domain) {
      const keys = mode === 'direct' ? await this.ensureKeys(scope, domain) : [];
      const dkimKeys = [...keys.filter((k) => k.status === 'active'), ...keys.filter((k) => k.status === 'pending')].map((k) => ({ selector: k.selector, publicKey: k.publicKey, status: k.status as 'active' | 'pending' }));
      records = await checkDomainDns({ resolver: this.deps.resolver, domain, mode, ip4: ip.v4 ? [ip.v4] : [], ip6: ip.v6 ? [ip.v6] : [], relayInclude: relayPreset(row?.relayPreset)?.spfInclude ?? null, dkimKeys });
    }
    const prev = (row?.lastCheck ?? null) as LastCheck | null;
    const wantServer = opts.server ?? true;
    const server = mode === 'direct' ? (wantServer ? await runServerChecks({ resolver: this.deps.resolver, probe: this.deps.probe, ip: ip.v4 ?? ip.v6 }) : prev?.server ?? null) : null;
    const last: LastCheck = { at: new Date().toISOString(), mode, domain, records, server, ip: { v4: ip.v4, v6: ip.v6, source: ip.source } };
    await saveEmailSettings(this.db, scope, { lastCheck: last, authDomain: domain, authOk: !!domain && mode === 'direct' && recordsAuthenticated(records), authCheckedAt: new Date() });
    return last;
  }

  async rotateKey(scope: EmailScope): Promise<boolean> {
    const domain = await this.domainOf(scope);
    if (!domain) return false;
    await ensureActiveKey(this.db, scope, domain, this.secret);
    await rotateDkimKey(this.db, scope, domain, this.secret);
    return true;
  }
  async activateKey(scope: EmailScope): Promise<boolean> {
    const domain = await this.domainOf(scope);
    if (!domain) return false;
    const k = await activateDkimKey(this.db, scope, domain);
    if (k) await saveEmailSettings(this.db, scope, { authOk: false, authCheckedAt: null }); // the new key must pass its own check before the store signs as itself
    return !!k;
  }

  async outbox(scope: EmailScope, limit = 25) {
    return (await listOutbox(this.db, scope, limit)).map((r) => ({
      id: r.id, to: r.toAddress, from: r.fromAddress, subject: r.subject, mode: r.mode, status: r.status, attempts: r.attempts, lastError: r.lastError, lastResponse: r.lastResponse, mxHost: r.mxHost,
      messageId: r.messageId, nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
    }));
  }

  // ---- health (banner) ---------------------------------------------------------------------------------------------------------

  async health(shopId: number | null): Promise<EmailHealth> {
    const shop = await this.shopOf(shopId);
    const { mode, row } = await this.modeOf(shopId);
    const reasons: string[] = [];
    const from = shop ? await this.fromDecision(shop, mode, row) : null;
    const last = (row?.lastCheck ?? null) as LastCheck | null;
    let status: EmailHealth['status'] = 'ok';
    if (mode === 'log') { reasons.push('no_mode'); status = 'problem'; }
    if (mode === 'direct') {
      const serverChecks = last?.server ?? (((await getEmailSettings(this.db, null))?.lastCheck ?? null) as LastCheck | null)?.server ?? null;
      for (const id of ['port25', 'dnsbl'] as const) if (serverChecks?.find((c) => c.id === id)?.status === 'error') reasons.push(id);
      if (from && !from.deliverable) reasons.push(last ? 'not_authenticated' : 'not_set_up');
      if (reasons.length) status = reasons.includes('not_set_up') && reasons.length === 1 ? 'unchecked' : 'problem';
    }
    if (mode === 'relay' && last?.records.some((r) => r.status === 'error')) { reasons.push('records'); status = 'problem'; }
    if (mode !== 'log' && (await recentFailureCount(this.db, shopId)) > 0) { reasons.push('failures'); status = 'problem'; }
    const done = status === 'ok' && (mode === 'relay' || mode === 'env' || (mode === 'direct' && from?.kind === 'store' && from.deliverable));
    return { status, reasons, effectiveMode: mode, fromKind: from?.kind ?? 'store', done };
  }

  // ---- unsubscribe -------------------------------------------------------------------------------------------------------------

  async unsubscribe(token: string): Promise<boolean> {
    const t = this.readUnsubscribeToken(token);
    if (!t) return false;
    const rows = await this.db.select({ id: s.customers.id, shopId: s.customers.shopId }).from(s.customers).where(eq(s.customers.email, t.email));
    for (const r of rows.filter((x) => x.shopId === t.shopId)) await updateEmailMarketingConsent(this.db, t.shopId, r.id, { marketingState: 'UNSUBSCRIBED' });
    return true;
  }

  // ---- background --------------------------------------------------------------------------------------------------------------

  /** Re-check scopes that send directly: often until SPF and DKIM pass (the store then signs as itself on its own), twice a day after. */
  async recheckDue(shopIds: number[], now = new Date()): Promise<number> {
    let n = 0;
    const scopes: EmailScope[] = [...shopIds, ...(this.config.multiStore || this.platformDomain() ? [null] : [])];
    for (const scope of scopes) {
      if (n >= 20) break;
      const { mode, row } = await this.modeOf(scope);
      if (mode !== 'direct' || !(await this.domainOf(scope))) continue;
      const age = row?.authCheckedAt ? now.getTime() - row.authCheckedAt.getTime() : Infinity;
      if (age < (row?.authOk ? 12 * 3_600_000 : 10 * 60_000)) continue;
      try { await this.check(scope, { server: scope === null }); n++; } catch (e) { this.ctx.log.warn({ err: errMessage(e) }, 'e-mail re-check failed'); }
    }
    return n;
  }

  async purge() { await purgeOutbox(this.db); }
}

export { EMAIL_RETRY_DELAYS_MS };
