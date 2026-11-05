import { and, eq } from 'drizzle-orm';
import { metaobjectDefinitions, type MetaobjectFieldDef } from '../../db/schema';
import type { Executor } from '../../db/client';
import type { Result } from '../catalog/common';

export type MetaobjectDefinition = typeof metaobjectDefinitions.$inferSelect;
export type { MetaobjectFieldDef };

/** User error with the Shopify-style `elementKey` / `elementIndex` extras. */
export type MoError = { field: string[] | null; message: string; code: string; elementKey?: string; elementIndex?: number };
export const moErr = (field: string[] | null, message: string, code: string, extra: { elementKey?: string; elementIndex?: number } = {}): MoError => ({ field, message, code, ...extra });
export const moFail = (...errors: MoError[]): Result<never> => ({ ok: false, errors });

export async function getMetaobjectDefinition(db: Executor, shopId: number, id: number): Promise<MetaobjectDefinition | null> {
  return (await db.select().from(metaobjectDefinitions).where(and(eq(metaobjectDefinitions.shopId, shopId), eq(metaobjectDefinitions.id, id))))[0] ?? null;
}
export async function getMetaobjectDefinitionByType(db: Executor, shopId: number, type: string): Promise<MetaobjectDefinition | null> {
  return (await db.select().from(metaobjectDefinitions).where(and(eq(metaobjectDefinitions.shopId, shopId), eq(metaobjectDefinitions.type, type))))[0] ?? null;
}

/** Entry display name: the display-name field when set, else the first single-line text field with a value, else the handle. */
export function entryDisplayName(def: Pick<MetaobjectDefinition, 'displayNameKey' | 'fieldDefinitions'>, values: Record<string, string>, handle: string): string {
  const show = (key: string) => { const v = values[key]; return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 255) : ''; };
  if (def.displayNameKey) { const v = show(def.displayNameKey); if (v) return v; }
  else for (const f of def.fieldDefinitions) if (f.type === 'single_line_text_field') { const v = show(f.key); if (v) return v; }
  return handle;
}
