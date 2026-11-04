import * as collections from './collections';
import * as common from './common';
import * as inventory from './inventory';
import * as products from './products';

/** Every operation string, keyed by export name. Used by `pnpm validate:graphql`. */
export const operations: Record<string, string> = { ...common, ...products, ...collections, ...inventory };

export * from './common';
export * from './products';
export * from './collections';
export * from './inventory';
