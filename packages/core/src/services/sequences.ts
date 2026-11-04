import { sql } from 'drizzle-orm';
import { sequences } from '../db/schema';
import type { Executor } from '../db/client';

/** Atomically allocate the next value of a per-shop counter. First value is `start`. */
export async function nextSequence(db: Executor, shopId: number, name: string, start = 1): Promise<number> {
  const rows = await db
    .insert(sequences)
    .values({ shopId, name, value: start })
    .onConflictDoUpdate({ target: [sequences.shopId, sequences.name], set: { value: sql`${sequences.value} + 1` } })
    .returning({ value: sequences.value });
  return rows[0]!.value;
}

export const ORDER_NUMBER_START = 1001;
export const nextOrderNumber = (db: Executor, shopId: number) => nextSequence(db, shopId, 'order_number', ORDER_NUMBER_START);
