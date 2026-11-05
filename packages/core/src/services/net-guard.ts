import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';

/**
 * SSRF guard for outbound requests the server makes on behalf of a shop (CSV image downloads, webhook deliveries).
 * Refuses loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, unspecified, multicast and
 * reserved addresses, for IPv4 and IPv6 (including IPv4-mapped and IPv4-compatible forms).
 */

export class BlockedAddressError extends Error {
  constructor(readonly address: string) {
    super('Address resolves to a private or loopback network');
    this.name = 'BlockedAddressError';
  }
}

/** Local development escape hatch for webhooks: `WEBHOOKS_ALLOW_PRIVATE=1` allows loopback and private targets. */
export const webhooksAllowPrivate = (): boolean => process.env.WEBHOOKS_ALLOW_PRIVATE === '1';

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast, reserved, broadcast
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) // private, IETF protocol assignments, TEST-NET-1
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) // benchmarking, TEST-NET-2
    || (a === 203 && b === 0 && c === 113); // TEST-NET-3
}

function isPrivateV6(ip: string): boolean {
  // WHATWG URL normalises every textual form (dotted or hex, expanded or compressed) to one canonical lower-case form.
  let h: string;
  try { h = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return true; }
  const embedded = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // ::ffff:a.b.c.d and ::a.b.c.d forms
  if (embedded) {
    const hi = parseInt(embedded[1]!, 16); const lo = parseInt(embedded[2]!, 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return h === '::' || h === '::1'
    || /^f[cd]/.test(h) // unique local fc00::/7
    || /^fe[89ab]/.test(h) // link-local fe80::/10
    || h.startsWith('ff') // multicast
    || h.startsWith('64:ff9b:') || h.startsWith('100:') || h.startsWith('2001:db8:') || h.startsWith('2001:0:'); // NAT64, discard, documentation, Teredo
}

/** True when `ip` (an IPv4 or IPv6 literal) must not be contacted. Anything that is not an IP literal is refused. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true;
}

/**
 * Validation-time check for a URL hostname: an IP literal is judged directly, a name is resolved and every address is judged.
 * Returns true when the target is private. A name that does not resolve returns false: delivery re-checks at connect time,
 * so an unresolvable host can never be reached through this path.
 */
export async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return isPrivateAddress(bare);
  const addrs = await new Promise<LookupAddress[]>((resolve) => dnsLookup(bare, { all: true }, (err, a) => resolve(err ? [] : a)));
  return addrs.some((a) => isPrivateAddress(a.address));
}

/**
 * DNS lookup for sockets that refuses private addresses. Judging the address the socket actually connects to closes the
 * window between a validation-time lookup and the request (DNS rebinding).
 */
export function guardedLookup(allowPrivate: boolean): LookupFunction {
  return ((hostname: string, options: { all?: boolean; family?: number; hints?: number }, callback: (...args: unknown[]) => void) => {
    dnsLookup(hostname, { all: true, family: options.family, hints: options.hints, verbatim: true }, (err, addrs) => {
      if (err) return callback(err);
      const bad = allowPrivate ? undefined : addrs.find((a) => isPrivateAddress(a.address));
      if (bad) return callback(new BlockedAddressError(bad.address));
      if (options.all) return callback(null, addrs);
      callback(null, addrs[0]!.address, addrs[0]!.family);
    });
  }) as LookupFunction;
}

export interface GuardedPost { headers: Record<string, string>; body: string; timeoutMs: number; allowPrivate: boolean }

/**
 * POST `url` and resolve with the HTTP status. Redirects are not followed (a 3xx is a failed delivery).
 * Rejects with {@link BlockedAddressError} when the target is private, before any connection is made.
 */
export function postGuarded(url: URL, o: GuardedPost): Promise<number> {
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !o.allowPrivate && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    return Promise.reject(new BlockedAddressError(url.hostname));
  }
  return new Promise<number>((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, {
      method: 'POST', headers: { ...o.headers, 'content-length': Buffer.byteLength(o.body) }, lookup: guardedLookup(o.allowPrivate),
    }, (res: IncomingMessage) => { res.resume(); clearTimeout(timer); resolve(res.statusCode ?? 0); });
    const timer = setTimeout(() => req.destroy(new Error('Request timed out')), o.timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(o.body);
  });
}
