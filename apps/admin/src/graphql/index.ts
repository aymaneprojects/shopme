import * as blogs from './blogs';
import * as collections from './collections';
import * as common from './common';
import * as drafts from './drafts';
import * as staff from './staff';
import * as customers from './customers';
import * as dashboard from './dashboard';
import * as discounts from './discounts';
import * as inventory from './inventory';
import * as onlineStore from './online-store';
import * as orders from './orders';
import * as products from './products';
import * as settings from './settings';

/** Every operation string, keyed by export name. Used by `pnpm validate:graphql`. */
export const operations: Record<string, string> = { ...common, ...blogs, ...drafts, ...staff, ...products, ...collections, ...inventory, ...orders, ...customers, ...discounts, ...settings, ...onlineStore, ...dashboard };

export * from './common';
export * from './blogs';
export * from './drafts';
export * from './staff';
export * from './products';
export * from './collections';
export * from './inventory';
export * from './orders';
export * from './customers';
export * from './discounts';
export * from './settings';
export * from './online-store';
export * from './dashboard';
