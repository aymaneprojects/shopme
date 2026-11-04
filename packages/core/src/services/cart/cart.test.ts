import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createLocalStorage, getPrimaryShop, runMigrations, schema as s, seedDemo, type DbHandle } from '../../index';
import { addItems, changeLine, clearCart, createCart, getCartByToken, lineKey, updateCart } from './service';

let h: DbHandle;
let shopId: number;
const sku: Record<string, number> = {};

beforeAll(async () => {
  h = await createDb({ memory: true });
  await runMigrations(h);
  await seedDemo(h.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'cart-'))));
  shopId = (await getPrimaryShop(h.db))!.id;
  for (const v of await h.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
}, 60_000);
afterAll(async () => { await h.close(); });

describe('cart service', () => {
  it('line keys depend on variant and properties only', () => {
    expect(lineKey(5, { a: '1' })).toBe(lineKey(5, { a: '1' }));
    expect(lineKey(5, { a: '1' })).not.toBe(lineKey(5, {}));
    expect(lineKey(5, {})).toMatch(/^5:[0-9a-f]{32}$/);
  });

  it('adds with stock enforcement, merges lines, and clears keeping notes', async () => {
    const cart = await createCart(h.db, shopId, 'EUR');
    expect(await getCartByToken(h.db, shopId, cart.token)).not.toBeNull();
    const a = await addItems(h.db, shopId, cart.id, [{ id: sku['CPD-SL'], quantity: 3 }]);
    expect(a.error).toBeUndefined();
    const b = await addItems(h.db, shopId, cart.id, [{ id: sku['CPD-SL'], quantity: 9 }]);
    expect(b.error?.message).toBe('Only 5 items were added to your cart due to availability.');
    expect(b.cart.lines).toHaveLength(1);
    expect(b.cart.lines[0]!.quantity).toBe(5);
    const c = await changeLine(h.db, shopId, cart.id, { line: 1, quantity: 2 });
    expect(c.deltas[0]!.delta).toBe(-3);
    await updateCart(h.db, shopId, cart.id, { note: 'n' });
    const cleared = await clearCart(h.db, shopId, cart.id);
    expect(cleared.lines).toEqual([]);
    expect(cleared.note).toBe('n');
    expect(cleared.token).toBe(cart.token);
  });
});
