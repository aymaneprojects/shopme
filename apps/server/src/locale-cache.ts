import type { IncomingMessage } from 'node:http';
import { getPrimaryShop, publishedLocales, schema as s, type Db } from '@shopme/core';
import type { StoreRegistry } from './stores';

export interface PublishedLocale { locale: string; name: string; primary: boolean; domain?: string | null }

/** Published languages of one store. */
export class ShopLocales {
  constructor(public primary = 'en', public locales: PublishedLocale[] = [{ locale: 'en', name: 'English', primary: true }]) {}
  byPrefix = new Map<string, string>();
  byHost = new Map<string, string>();
  static of(primary: string, locales: PublishedLocale[]): ShopLocales {
    const l = new ShopLocales(primary, locales);
    l.byHost = new Map(locales.flatMap((x) => (x.domain ? [[x.domain.toLowerCase(), x.locale] as const] : [])));
    l.byPrefix = new Map(locales.filter((x) => !x.primary).map((x) => [x.locale.toLowerCase(), x.locale]));
    return l;
  }
  /** URL prefix of a locale (`''` for the primary one). */
  prefixOf(locale: string): string { return locale === this.primary ? '' : `/${locale.toLowerCase()}`; }
}

/**
 * The published storefront languages, kept in memory so the URL rewrite (which runs before routing and is synchronous) can
 * strip a `/fr` prefix and remember the locale of the request. Refreshed at start and whenever locales or the shop change.
 * Single-store mode keeps the languages of the store; multi-store mode keeps them per store and picks the store by host.
 */
export class LocaleCache {
  private byShop = new Map<number, ShopLocales>();
  private single = new ShopLocales();
  private byReq = new WeakMap<IncomingMessage, string>();

  constructor(private stores?: StoreRegistry) {}

  /** Languages of the single store (single-store mode). */
  get primary() { return this.single.primary; }
  get locales() { return this.single.locales; }

  async refresh(db: Db): Promise<void> {
    if (this.stores?.multi) {
      await this.stores.refresh(db);
      const next = new Map<number, ShopLocales>();
      for (const row of await db.select({ id: s.shops.id, locale: s.shops.locale }).from(s.shops)) next.set(row.id, ShopLocales.of(row.locale, await publishedLocales(db, row.id)));
      this.byShop = next;
      return;
    }
    const shop = await getPrimaryShop(db);
    if (!shop) return;
    this.single = ShopLocales.of(shop.locale, await publishedLocales(db, shop.id));
    this.byShop = new Map([[shop.id, this.single]]);
  }

  /** Languages of a store. */
  of(shopId: number): ShopLocales {
    return this.byShop.get(shopId) ?? (this.stores?.multi ? new ShopLocales() : this.single);
  }

  private forHost(host: string | undefined): ShopLocales | null {
    if (!this.stores?.multi) return this.single;
    const id = this.stores.idForHostSync(host);
    return id == null ? null : this.of(id);
  }

  /** `/fr/products/x?y=1` -> `/products/x?y=1` (and remembers `fr` for the request); other URLs are returned unchanged. */
  rewrite(req: IncomingMessage, url = req.url ?? '/'): string {
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    const shop = this.forHost(host);
    if (!shop) return url;
    const byHost = shop.byHost.get(host);
    if (byHost) this.byReq.set(req, byHost);
    if (!shop.byPrefix.size) return url;
    const m = /^\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)(?=[/?#]|$)/.exec(url);
    const locale = m && shop.byPrefix.get(m[1]!.toLowerCase());
    if (!locale) return url;
    this.byReq.set(req, locale);
    const rest = url.slice(m![0].length);
    return rest === '' || rest[0] === '?' ? `/${rest}` : rest;
  }

  localeOf(req: IncomingMessage): string | undefined { return this.byReq.get(req); }
  /** URL prefix of a locale of the single store (`''` for the primary one). */
  prefixOf(locale: string): string { return this.single.prefixOf(locale); }
}
