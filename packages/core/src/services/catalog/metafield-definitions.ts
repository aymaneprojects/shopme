import { and, asc, count, desc, eq } from 'drizzle-orm';
import { metafieldDefinitions, metafields } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { emit, errR, okR, txResult, type Result } from './common';
import { METAFIELD_BASE_TYPES } from './metafields';

export type MetafieldDefinition = typeof metafieldDefinitions.$inferSelect;
export interface Validation { name: string; value: string }
export interface DefinitionInput {
  ownerType?: string; namespace?: string | null; key?: string; name?: string | null; description?: string | null; type?: string;
  validations?: Validation[] | null; pin?: boolean | null; storefrontVisible?: boolean | null;
}

const isType = (t: string) => METAFIELD_BASE_TYPES.includes(t.startsWith('list.') ? t.slice(5) : t);

export async function getDefinition(db: Executor, shopId: number, id: number): Promise<MetafieldDefinition | null> {
  const [r] = await db.select().from(metafieldDefinitions).where(and(eq(metafieldDefinitions.shopId, shopId), eq(metafieldDefinitions.id, id)));
  return r ?? null;
}

export async function findDefinition(db: Executor, shopId: number, ownerType: string, namespace: string, key: string): Promise<MetafieldDefinition | null> {
  const [r] = await db.select().from(metafieldDefinitions).where(and(
    eq(metafieldDefinitions.shopId, shopId), eq(metafieldDefinitions.ownerType, ownerType), eq(metafieldDefinitions.namespace, namespace), eq(metafieldDefinitions.key, key)));
  return r ?? null;
}

export function listDefinitions(db: Executor, shopId: number, o: { ownerType?: string | null; namespace?: string | null; pinned?: boolean | null; offset: number; limit: number; reverse?: boolean }): Promise<MetafieldDefinition[]> {
  const d = metafieldDefinitions;
  return db.select().from(d).where(and(eq(d.shopId, shopId), o.ownerType ? eq(d.ownerType, o.ownerType) : undefined, o.namespace ? eq(d.namespace, o.namespace) : undefined, o.pinned == null ? undefined : eq(d.pinned, o.pinned)))
    .orderBy(o.reverse ? desc(d.id) : asc(d.id)).limit(o.limit).offset(o.offset);
}

/** Number of metafield values stored under a definition. */
export async function definitionValuesCount(db: Executor, shopId: number, d: MetafieldDefinition): Promise<number> {
  const [r] = await db.select({ n: count() }).from(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, d.ownerType), eq(metafields.namespace, d.namespace), eq(metafields.key, d.key)));
  return Number(r?.n ?? 0);
}

function check(i: DefinitionInput, creating: boolean): Result<null> {
  if (creating) {
    const ns = (i.namespace ?? 'custom').trim();
    if (!/^[A-Za-z0-9_-]{3,255}$/.test(ns)) return errR(['namespace'], 'Namespace is invalid (3-255 letters, digits, - and _).', 'INVALID');
    if (!i.key || !/^[A-Za-z0-9_-]{2,64}$/.test(i.key)) return errR(['key'], 'Key is invalid (2-64 letters, digits, - and _).', 'INVALID');
    if (!i.type || !isType(i.type)) return errR(['type'], `Type '${i.type ?? ''}' is not a valid metafield type.`, 'INCLUSION');
    if (!i.ownerType) return errR(['ownerType'], 'Owner type is required.', 'INVALID');
  }
  if (i.name !== undefined && !i.name?.trim()) return errR(['name'], "Name can't be blank.", 'BLANK');
  return okR(null);
}

export async function createDefinition(db: Db, shopId: number, i: DefinitionInput): Promise<Result<MetafieldDefinition>> {
  const v = check(i, true);
  if (!v.ok) return v;
  const namespace = (i.namespace ?? 'custom').trim();
  if (!i.name?.trim()) return errR(['name'], "Name can't be blank.", 'BLANK');
  return txResult(db, async (tx) => {
    if (await findDefinition(tx, shopId, i.ownerType!, namespace, i.key!)) return errR(['key'], 'A definition with this namespace and key already exists.', 'TAKEN');
    const [row] = await tx.insert(metafieldDefinitions).values({
      shopId, ownerType: i.ownerType!, namespace, key: i.key!, name: i.name!.trim(), description: i.description ?? null, type: i.type!,
      validations: i.validations ?? [], pinned: !!i.pin, storefrontVisible: i.storefrontVisible ?? true,
    }).returning();
    await emit(tx, shopId, 'metafield_definition', row!.id, 'metafield_definitions/create');
    return okR(row!);
  });
}

/** Type, namespace, key and owner type are immutable once created (like Shopify). */
export async function updateDefinition(db: Db, shopId: number, i: DefinitionInput): Promise<Result<MetafieldDefinition>> {
  const v = check(i, false);
  if (!v.ok) return v;
  const cur = await findDefinition(db, shopId, i.ownerType ?? '', (i.namespace ?? 'custom').trim(), i.key ?? '');
  if (!cur) return errR(['key'], 'Definition not found.', 'NOT_FOUND');
  const [row] = await db.update(metafieldDefinitions).set({
    ...(i.name != null && { name: i.name.trim() }), ...(i.description !== undefined && { description: i.description }), ...(i.validations && { validations: i.validations }),
    ...(i.pin != null && { pinned: i.pin }), ...(i.storefrontVisible != null && { storefrontVisible: i.storefrontVisible }), updatedAt: new Date(),
  }).where(eq(metafieldDefinitions.id, cur.id)).returning();
  return okR(row!);
}

export async function deleteDefinition(db: Db, shopId: number, id: number, deleteValues: boolean): Promise<Result<number>> {
  const cur = await getDefinition(db, shopId, id);
  if (!cur) return errR(['id'], 'Definition not found.', 'NOT_FOUND');
  return txResult(db, async (tx) => {
    if (deleteValues) await tx.delete(metafields).where(and(eq(metafields.shopId, shopId), eq(metafields.ownerType, cur.ownerType), eq(metafields.namespace, cur.namespace), eq(metafields.key, cur.key)));
    await tx.delete(metafieldDefinitions).where(eq(metafieldDefinitions.id, id));
    return okR(id);
  });
}
