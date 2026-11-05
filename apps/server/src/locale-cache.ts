import type { IncomingMessage } from 'node:http';
import { getPrimaryShop, publishedLocales, type Db } from '@shopme/core';

export interface PublishedLocale { locale: string; name: string; primary: boolean }

/**
 * The published storefront languages, kept in memory so the URL rewrite (which runs before routing and is synchronous) can
 * strip a `/fr` prefix and remember the locale of the request. Refreshed at start and whenever locales or the shop change.
 */
export class LocaleCache {
  primary = 'en';
  locales: PublishedLocale[] = [{ locale: 'en', name: 'English', primary: true }];
  private byPrefix = new Map<string, string>();
  private byReq = new WeakMap<IncomingMessage, string>();

  async refresh(db: Db): Promise<void> {
    const shop = await getPrimaryShop(db);
    if (!shop) return;
    this.locales = await publishedLocales(db, shop.id);
    this.primary = shop.locale;
    this.byPrefix = new Map(this.locales.filter((l) => !l.primary).map((l) => [l.locale.toLowerCase(), l.locale]));
  }

  /** `/fr/products/x?y=1` -> `/products/x?y=1` (and remembers `fr` for the request); other URLs are returned unchanged. */
  rewrite(req: IncomingMessage): string {
    const url = req.url ?? '/';
    if (!this.byPrefix.size) return url;
    const m = /^\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)(?=[/?#]|$)/.exec(url);
    const locale = m && this.byPrefix.get(m[1]!.toLowerCase());
    if (!locale) return url;
    this.byReq.set(req, locale);
    const rest = url.slice(m![0].length);
    return rest === '' || rest[0] === '?' ? `/${rest}` : rest;
  }

  localeOf(req: IncomingMessage): string | undefined { return this.byReq.get(req); }
  /** URL prefix of a locale (`''` for the primary one). */
  prefixOf(locale: string): string { return locale === this.primary ? '' : `/${locale.toLowerCase()}`; }
}
