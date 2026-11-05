export const DEFAULT_API_VERSION = '2026-10';

export type ShopifyAuth = { token: string } | { clientId: string; clientSecret: string };

export interface ShopifyClientOptions {
  /** `my-store`, `my-store.myshopify.com` or a full URL. */
  shop: string;
  auth: ShopifyAuth;
  apiVersion?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onThrottle?: (waitMs: number) => void;
}

interface Cost { requestedQueryCost?: number; actualQueryCost?: number | null; throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } }

export class ShopifyError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export const normalizeShop = (s: string) => `${s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.myshopify\.com$/, '')}.myshopify.com`;

/** Admin GraphQL client with a cost-based throttle (leaky bucket) and retry on THROTTLED / 429 / 5xx. */
export class ShopifyClient {
  readonly domain: string;
  private token: string | null;
  private tokenExpiresAt = 0;
  private bucket = { available: 1000, max: 1000, rate: 50, at: Date.now() };
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly apiVersion: string;

  constructor(private readonly opts: ShopifyClientOptions) {
    this.domain = normalizeShop(opts.shop);
    this.token = 'token' in opts.auth ? opts.auth.token : null;
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
  }

  private async accessToken(): Promise<string> {
    const a = this.opts.auth;
    if ('token' in a) return a.token;
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const res = await this.f(`https://${this.domain}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: a.clientId, client_secret: a.clientSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) throw new ShopifyError(`Could not obtain an access token (HTTP ${res.status})`, 'AUTH');
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + (body.expires_in ?? 86_400) * 1000;
    return this.token;
  }

  private refill() {
    const now = Date.now();
    this.bucket.available = Math.min(this.bucket.max, this.bucket.available + ((now - this.bucket.at) / 1000) * this.bucket.rate);
    this.bucket.at = now;
  }

  private async waitFor(cost: number) {
    this.refill();
    const need = Math.min(cost, this.bucket.max) - this.bucket.available;
    if (need > 0) {
      const ms = Math.ceil((need / this.bucket.rate) * 1000) + 50;
      this.opts.onThrottle?.(ms);
      await this.sleep(ms);
      this.refill();
    }
  }

  /** Run a query. Returns `data`; throws ShopifyError (code ACCESS_DENIED for missing scopes) on GraphQL errors. */
  async query<T = any>(query: string, variables: Record<string, unknown> = {}, estimatedCost = 100): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.waitFor(estimatedCost);
      const res = await this.f(`https://${this.domain}/admin/api/${this.apiVersion}/graphql.json`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': await this.accessToken() }, body: JSON.stringify({ query, variables }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 6) { await this.sleep(Math.min(30_000, 1000 * 2 ** attempt)); continue; }
      if (res.status === 401 || res.status === 403) throw new ShopifyError(`Shopify rejected the credentials (HTTP ${res.status})`, 'AUTH');
      if (!res.ok) throw new ShopifyError(`Shopify returned HTTP ${res.status}`);
      const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[]; extensions?: { cost?: Cost } };
      const ts = body.extensions?.cost?.throttleStatus;
      if (ts) this.bucket = { available: ts.currentlyAvailable, max: ts.maximumAvailable, rate: ts.restoreRate, at: Date.now() };
      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < 6) { this.bucket.available = 0; continue; }
      if (body.errors?.length) {
        const denied = body.errors.some((e) => e.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(e.message));
        throw new ShopifyError(body.errors.map((e) => e.message).join('; '), denied ? 'ACCESS_DENIED' : body.errors[0]?.extensions?.code);
      }
      return body.data as T;
    }
  }

  /** Iterate all nodes of a top-level connection. `build(cursorArg)` returns the query using `$after`; `pick` extracts the connection. */
  async *paginate<N>(query: string, pick: (data: any) => { nodes: N[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }, variables: Record<string, unknown> = {}, estimatedCost = 100): AsyncGenerator<N> {
    let after: string | null = null;
    for (;;) {
      const conn = pick(await this.query(query, { ...variables, after }, estimatedCost));
      for (const n of conn.nodes) yield n;
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) return;
      after = conn.pageInfo.endCursor;
    }
  }
}
