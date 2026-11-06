import { describe, expect, it } from 'vitest';
import {
  DNSBL_ZONES, buildRecords, checkDomainDns, clearDnsblCache, decideFrom, dkimPublicKeyOf, dkimTxtValue, generateDkimKey, isFreeMailboxDomain, mergeSpf, nextSelector, parsePublicIp, recordsAuthenticated, reverseIp4,
  runServerChecks, sendingDomainOf, spfCovers, type DnsResolver, type FromInput,
} from './index';

describe('SPF merge', () => {
  const add = { ip4: ['203.0.113.7'] };
  it('builds a fresh record when there is none', () => {
    expect(mergeSpf([], add)).toMatchObject({ value: 'v=spf1 ip4:203.0.113.7 ~all', changed: true, existingCount: 0 });
  });
  it('merges into the one existing record, before the final all, keeping its qualifier', () => {
    const r = mergeSpf(['v=spf1 include:_spf.google.com -all'], { ip4: ['203.0.113.7'], ip6: ['2001:db8::1'] });
    expect(r.value).toBe('v=spf1 include:_spf.google.com ip4:203.0.113.7 ip6:2001:db8::1 -all');
    expect(r.changed).toBe(true);
  });
  it('does not duplicate what is already authorised', () => {
    const r = mergeSpf(['v=spf1 ip4:203.0.113.7 include:spf.brevo.com ~all'], { ip4: ['203.0.113.7'], include: ['spf.brevo.com'] });
    expect(r.changed).toBe(false);
    expect(r.value).toBe('v=spf1 ip4:203.0.113.7 include:spf.brevo.com ~all');
  });
  it('relay mode adds the include', () => {
    expect(mergeSpf(['v=spf1 mx ~all'], { include: ['amazonses.com'] }).value).toBe('v=spf1 mx include:amazonses.com ~all');
  });
  it('flags several records, permissive endings and redirects', () => {
    expect(mergeSpf(['v=spf1 mx ~all', 'v=spf1 a ~all'], add).problems).toContain('multiple');
    expect(mergeSpf(['v=spf1 +all'], add).problems).toContain('permissive');
    expect(mergeSpf(['v=spf1 redirect=_spf.example.net'], add).problems).toContain('redirect');
    expect(mergeSpf(['v=spf1 ?all'], add).problems).toContain('neutral');
  });
  it('ignores TXT records that are not SPF', () => {
    expect(mergeSpf(['google-site-verification=abc'], add).existingCount).toBe(0);
  });
  it('spfCovers matches literally', () => {
    expect(spfCovers('v=spf1 ip4:1.2.3.4 -all', { ip4: ['1.2.3.4'] })).toBe(true);
    expect(spfCovers('v=spf1 ip4:1.2.3.4 -all', { ip4: ['1.2.3.5'] })).toBe(false);
  });
});

describe('DKIM and domain helpers', () => {
  it('generates RSA 2048 keys whose public part is the p= value', () => {
    const k = generateDkimKey();
    expect(k.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(Buffer.from(k.publicKey, 'base64').length).toBeGreaterThan(250);
    expect(dkimPublicKeyOf(dkimTxtValue(k.publicKey))).toBe(k.publicKey);
  });
  it('rotates selectors', () => { expect(nextSelector([])).toBe('shopme1'); expect(nextSelector(['shopme1', 'shopme3'])).toBe('shopme4'); });
  it('finds the sending domain and free mailboxes', () => {
    expect(sendingDomainOf('Shop <hello@Mon-Shop.fr>')).toBeNull(); // not a bare address
    expect(sendingDomainOf('hello@Mon-Shop.fr')).toBe('mon-shop.fr');
    expect(sendingDomainOf('x@localhost')).toBeNull();
    expect(isFreeMailboxDomain('gmail.com')).toBe(true);
    expect(isFreeMailboxDomain('mon-shop.fr')).toBe(false);
  });
  it('parses PUBLIC_IP', () => { expect(parsePublicIp('203.0.113.7, 2001:db8::1')).toEqual({ v4: '203.0.113.7', v6: '2001:db8::1' }); expect(parsePublicIp('nope')).toEqual({ v4: null, v6: null }); });
});

/** A resolver answering from a table; anything else is "no such record". */
function mockResolver(t: { txt?: Record<string, string[]>; cname?: Record<string, string[]>; mx?: Record<string, string[]>; a?: Record<string, string[]>; ptr?: Record<string, string[]>; txtError?: string }): DnsResolver {
  const nf = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  return {
    resolveTxt: async (n) => { if (t.txtError && n.startsWith('_dmarc')) throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); const v = t.txt?.[n]; if (!v) throw nf(); return v.map((x) => [x.slice(0, 20), x.slice(20)]); },
    resolveCname: async (n) => { const v = t.cname?.[n]; if (!v) throw nf(); return v; },
    resolveMx: async (n) => { const v = t.mx?.[n]; if (!v) throw nf(); return v.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 })); },
    resolve4: async (n) => { const v = t.a?.[n]; if (!v) throw nf(); return v; },
    resolve6: async () => { throw nf(); },
    reverse: async (ip) => { const v = t.ptr?.[ip]; if (!v) throw nf(); return v; },
  };
}

describe('DNS checks with a mocked resolver', () => {
  const key = generateDkimKey();
  const base = { domain: 'shop.example.com', mode: 'direct' as const, ip4: ['203.0.113.7'], ip6: [], relayInclude: null, dkimKeys: [{ selector: 'shopme1', publicKey: key.publicKey, status: 'active' as const }] };
  const dkimTxt = dkimTxtValue(key.publicKey);

  it('everything published: green', async () => {
    const r = mockResolver({ txt: { 'shop.example.com': ['v=spf1 ip4:203.0.113.7 ~all'], 'shopme1._domainkey.shop.example.com': [dkimTxt], '_dmarc.shop.example.com': ['v=DMARC1; p=none; rua=mailto:a@shop.example.com'] } });
    const c = await checkDomainDns({ ...base, resolver: r });
    expect(c.map((x) => [x.id, x.status, x.code])).toEqual([['spf', 'ok', 'ok'], ['dkim', 'ok', 'ok'], ['dmarc', 'ok', 'monitor']]);
    expect(recordsAuthenticated(c)).toBe(true);
  });
  it('nothing published: SPF and DKIM red, DMARC orange', async () => {
    const c = await checkDomainDns({ ...base, resolver: mockResolver({}) });
    expect(c.map((x) => [x.id, x.status, x.code])).toEqual([['spf', 'error', 'missing'], ['dkim', 'error', 'missing'], ['dmarc', 'warn', 'missing']]);
    expect(recordsAuthenticated(c)).toBe(false);
  });
  it('SPF that does not authorise the server, two SPF records, a different DKIM key', async () => {
    const other = generateDkimKey();
    const c1 = await checkDomainDns({ ...base, resolver: mockResolver({ txt: { 'shop.example.com': ['v=spf1 include:_spf.google.com ~all'], '_spf.google.com': ['v=spf1 ip4:198.51.100.0/24 ~all'], 'shopme1._domainkey.shop.example.com': [dkimTxtValue(other.publicKey)] } }) });
    expect(c1[0]).toMatchObject({ status: 'error', code: 'ip_missing', detail: '203.0.113.7' });
    expect(c1[1]).toMatchObject({ status: 'error', code: 'mismatch' });
    const c2 = await checkDomainDns({ ...base, resolver: mockResolver({ txt: { 'shop.example.com': ['v=spf1 mx ~all', 'v=spf1 a ~all'] } }) });
    expect(c2[0]).toMatchObject({ status: 'error', code: 'multiple' });
  });
  it('follows includes and CIDR ranges when judging SPF', async () => {
    const r = mockResolver({ txt: { 'shop.example.com': ['v=spf1 include:_spf.host.net ~all'], '_spf.host.net': ['v=spf1 ip4:203.0.113.0/24 -all'] } });
    expect((await checkDomainDns({ ...base, resolver: r }))[0]!.status).toBe('ok');
  });
  it('a CNAME on the DKIM name is reported, a resolver error is "unknown"', async () => {
    const c = await checkDomainDns({ ...base, resolver: mockResolver({ cname: { 'shopme1._domainkey.shop.example.com': ['k.other.net'] }, txtError: 'x' }) });
    expect(c[1]).toMatchObject({ status: 'warn', code: 'cname', detail: 'k.other.net' });
    expect(c[2]).toMatchObject({ status: 'unknown', code: 'lookup_error' });
  });
  it('relay mode: include checked, DKIM left to the relay', async () => {
    const r = mockResolver({ txt: { 'shop.example.com': ['v=spf1 mx ~all'] } });
    const c = await checkDomainDns({ ...base, mode: 'relay', relayInclude: 'spf.brevo.com', dkimKeys: [], resolver: r });
    expect(c[0]).toMatchObject({ status: 'warn', code: 'include_missing' });
    expect(c[1]).toMatchObject({ status: 'unknown', code: 'relay' });
  });
  it('proposes records with the merged SPF', () => {
    const recs = buildRecords({ domain: 'shop.example.com', mode: 'direct', ip4: ['203.0.113.7'], ip6: [], relayInclude: null, existingSpf: ['v=spf1 mx -all'], dkim: { selector: 'shopme1', publicKey: 'AAA' }, dmarcReportEmail: null });
    expect(recs.map((x) => x.host)).toEqual(['shop.example.com', 'shopme1._domainkey.shop.example.com', '_dmarc.shop.example.com']);
    expect(recs[0]!.value).toBe('v=spf1 mx ip4:203.0.113.7 -all');
    expect(recs[2]!.value).toBe('v=DMARC1; p=none; rua=mailto:postmaster@shop.example.com');
  });
});

describe('server checks with a mocked resolver and probe', () => {
  const ip = '203.0.113.7';
  const gmail = { mx: { 'gmail.com': ['gmail-smtp-in.l.google.com'], 'outlook.com': ['outlook-mx.example.net'] } };
  it('all good', async () => {
    clearDnsblCache();
    const r = mockResolver({ ...gmail, ptr: { [ip]: ['mail.shop.example.com'] }, a: { 'mail.shop.example.com': [ip] } });
    const c = await runServerChecks({ resolver: r, ip, probe: async () => ({ ok: true, banner: '220 mx ESMTP' }) });
    expect(c.map((x) => [x.id, x.status])).toEqual([['ip', 'ok'], ['port25', 'ok'], ['ptr', 'ok'], ['dnsbl', 'ok']]);
  });
  it('port 25 blocked, no PTR, listed on a blocklist', async () => {
    clearDnsblCache();
    const base = mockResolver({ ...gmail });
    const r: DnsResolver = { ...base, resolve4: async (n) => { if (n === `${reverseIp4(ip)}.${DNSBL_ZONES[0]}`) return ['127.0.0.2']; throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); } };
    const c = await runServerChecks({ resolver: r, ip, probe: async () => ({ ok: false, error: 'timeout' }) });
    expect(c.find((x) => x.id === 'port25')).toMatchObject({ status: 'error', code: 'timeout' });
    expect(c.find((x) => x.id === 'ptr')).toMatchObject({ status: 'error', code: 'missing' });
    expect(c.find((x) => x.id === 'dnsbl')).toMatchObject({ status: 'error', code: 'listed' });
  });
  it('PTR that does not resolve back, and a list that refuses the resolver', async () => {
    clearDnsblCache();
    const base = mockResolver({ ...gmail, ptr: { [ip]: ['old.example.org'] } });
    const r: DnsResolver = { ...base, resolve4: async (n) => { if (n.endsWith(DNSBL_ZONES[0]!)) return ['127.255.255.254']; throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); } };
    const c = await runServerChecks({ resolver: r, ip, probe: async () => ({ ok: true }) });
    expect(c.find((x) => x.id === 'ptr')).toMatchObject({ status: 'warn', code: 'not_confirmed' });
    expect(c.find((x) => x.id === 'dnsbl')).toMatchObject({ status: 'ok' }); // the other lists answered "clean"
    clearDnsblCache();
    const refusing: DnsResolver = { ...base, resolve4: async () => ['127.255.255.254'] };
    expect((await runServerChecks({ resolver: refusing, ip, probe: async () => ({ ok: true }) })).find((x) => x.id === 'dnsbl')).toMatchObject({ status: 'unknown', code: 'refused' });
  });
  it('unknown IP', async () => {
    const c = await runServerChecks({ resolver: mockResolver(gmail), ip: null, probe: async () => ({ ok: true }) });
    expect(c.find((x) => x.id === 'ip')!.status).toBe('unknown');
  });
});

describe('which From is used', () => {
  const base: FromInput = { mode: 'direct', storeAddress: 'hello@boutique.fr', storeAuthenticated: true, platform: { address: 'no-reply@platform.example', authenticated: true }, defaultAddress: 'no-reply@localhost' };
  it('authenticated store domain: its own address', () => {
    expect(decideFrom(base)).toMatchObject({ address: 'hello@boutique.fr', kind: 'store', reason: 'store', deliverable: true });
  });
  it('domain not authenticated yet: the platform address on behalf of the store', () => {
    expect(decideFrom({ ...base, storeAuthenticated: false })).toMatchObject({ address: 'no-reply@platform.example', kind: 'platform', reason: 'unauthenticated', deliverable: true });
  });
  it('free mailbox: never used in From, even when "authenticated"', () => {
    expect(decideFrom({ ...base, storeAddress: 'boutique@gmail.com', storeAuthenticated: true })).toMatchObject({ address: 'no-reply@platform.example', kind: 'platform', reason: 'free_mailbox' });
  });
  it('no sender address: the platform address', () => {
    expect(decideFrom({ ...base, storeAddress: null })).toMatchObject({ kind: 'platform', reason: 'no_sender' });
  });
  it('platform not authenticated (or none): not deliverable, the store address is still tried', () => {
    expect(decideFrom({ ...base, storeAuthenticated: false, platform: { address: 'no-reply@platform.example', authenticated: false } })).toMatchObject({ address: 'hello@boutique.fr', kind: 'store', reason: 'unverified_nowhere', deliverable: false });
    expect(decideFrom({ ...base, storeAddress: 'boutique@gmail.com', storeAuthenticated: false, platform: null })).toMatchObject({ address: 'no-reply@localhost', deliverable: false });
  });
  it('relay and installation SMTP keep the store address, whatever its domain', () => {
    expect(decideFrom({ ...base, mode: 'relay', storeAuthenticated: false })).toMatchObject({ address: 'hello@boutique.fr', kind: 'store', deliverable: true });
    expect(decideFrom({ ...base, mode: 'env', storeAddress: null })).toMatchObject({ address: 'no-reply@localhost', kind: 'store' });
  });
});
