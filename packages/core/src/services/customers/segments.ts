import { eq } from 'drizzle-orm';
import { shops } from '../../db/schema';
import type { Db } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';

/**
 * Customer segments: a name plus a saved customer search (the same `field:value` syntax the customer list accepts).
 * Stored in the free-form `shops.settings` JSON under `customerSegments`, so no table is needed.
 */
export interface CustomerSegment { id: number; name: string; query: string; createdAt: string; updatedAt: string }

const KEY = 'customerSegments';
const read = (settings: Record<string, unknown>): CustomerSegment[] => (Array.isArray(settings[KEY]) ? (settings[KEY] as CustomerSegment[]) : []);

async function load(db: Db, shopId: number) {
  const [row] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
  return row?.settings ?? null;
}
const save = (db: Db, shopId: number, settings: Record<string, unknown>, list: CustomerSegment[]) =>
  db.update(shops).set({ settings: { ...settings, [KEY]: list }, updatedAt: new Date() }).where(eq(shops.id, shopId));

export async function listCustomerSegments(db: Db, shopId: number): Promise<CustomerSegment[]> {
  const s = await load(db, shopId);
  return s ? read(s) : [];
}

export async function getCustomerSegment(db: Db, shopId: number, id: number): Promise<CustomerSegment | null> {
  return (await listCustomerSegments(db, shopId)).find((x) => x.id === id) ?? null;
}

function validate(input: { name?: string | null; query?: string | null }, creating: boolean): Result<{ name?: string; query?: string }> {
  const out: { name?: string; query?: string } = {};
  if (creating || input.name !== undefined) {
    const name = input.name?.trim() ?? '';
    if (!name) return errR(['name'], "Name can't be blank", 'BLANK');
    if (name.length > 255) return errR(['name'], 'Name is too long (maximum is 255 characters)', 'TOO_LONG');
    out.name = name;
  }
  if (creating || input.query !== undefined) {
    const query = input.query?.trim() ?? '';
    if (query.length > 2000) return errR(['query'], 'Query is too long (maximum is 2000 characters)', 'TOO_LONG');
    out.query = query;
  }
  return okR(out);
}

export async function createCustomerSegment(db: Db, shopId: number, input: { name: string; query: string }): Promise<Result<CustomerSegment>> {
  const v = validate(input, true);
  if (!v.ok) return v;
  const settings = await load(db, shopId);
  if (!settings) return errR(null, 'Shop not found');
  const list = read(settings);
  const now = new Date().toISOString();
  const seg: CustomerSegment = { id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1, name: v.value.name!, query: v.value.query!, createdAt: now, updatedAt: now };
  await save(db, shopId, settings, [...list, seg]);
  return okR(seg);
}

export async function updateCustomerSegment(db: Db, shopId: number, id: number, input: { name?: string | null; query?: string | null }): Promise<Result<CustomerSegment>> {
  const v = validate(input, false);
  if (!v.ok) return v;
  const settings = await load(db, shopId);
  const list = settings ? read(settings) : [];
  const cur = list.find((x) => x.id === id);
  if (!settings || !cur) return errR(['id'], 'Segment does not exist', 'DOES_NOT_EXIST');
  const next = { ...cur, ...v.value, updatedAt: new Date().toISOString() };
  await save(db, shopId, settings, list.map((x) => (x.id === id ? next : x)));
  return okR(next);
}

export async function deleteCustomerSegment(db: Db, shopId: number, id: number): Promise<Result<number>> {
  const settings = await load(db, shopId);
  const list = settings ? read(settings) : [];
  if (!settings || !list.some((x) => x.id === id)) return errR(['id'], 'Segment does not exist', 'DOES_NOT_EXIST');
  await save(db, shopId, settings, list.filter((x) => x.id !== id));
  return okR(id);
}
