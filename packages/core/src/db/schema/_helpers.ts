import { bigint, bigserial, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** bigserial primary key (JS number; ids stay far below 2^53). */
export const pk = () => bigserial('id', { mode: 'number' }).primaryKey();
/** Tenant column. Every tenant-owned table has it (multi-tenant ShopMe Cloud stays possible). */
export const shopIdCol = () => bigint('shop_id', { mode: 'number' }).notNull();
/** Plain bigint FK-like column (use `.references` at the call site). */
export const ref = (name: string) => bigint(name, { mode: 'number' });
/** Money in minor units (cents). bigint so large totals cannot overflow. */
export const money = (name: string) => bigint(name, { mode: 'number' });
export const qty = (name: string) => integer(name);
export const createdAt = (name = 'created_at') => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
export const ts = (name: string) => timestamp(name, { withTimezone: true });
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
export const tagsCol = () => text('tags').array().notNull().default(sql`'{}'::text[]`);

/** `col in ('A','B')` CHECK expression (enums as text + check, so API enums can grow). */
export const oneOf = (col: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '))})`;
