import { and, eq, sql } from 'drizzle-orm';
import { customers, type discountExtensions } from '../../db/schema';
import type { Executor } from '../../db/client';
import { customerMatchesQuery } from '../customers/customers';
import { listCustomerSegments } from '../customers/segments';

export type DiscountEligibility = 'ALL' | 'SEGMENTS' | 'CUSTOMERS';
export const DISCOUNT_ELIGIBILITIES: readonly DiscountEligibility[] = ['ALL', 'SEGMENTS', 'CUSTOMERS'];

type Ext = Pick<typeof discountExtensions.$inferSelect, 'eligibility' | 'segmentIds' | 'customerIds'>;

/**
 * Whether the buyer (identified by email at checkout) may use a discount: everyone, a member of one of the listed customer segments
 * (saved customer searches), or one of the listed customers. A buyer who is not a known customer yet only qualifies for "all customers".
 */
export async function discountEligibleFor(db: Executor, shopId: number, ext: Ext | undefined, email: string | null | undefined): Promise<boolean> {
  if (!ext || ext.eligibility === 'ALL') return true;
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return false;
  const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), sql`lower(${customers.email}) = ${e}`)).limit(1);
  if (!customer) return false;
  if (ext.eligibility === 'CUSTOMERS') return ext.customerIds.includes(customer.id);
  const segments = (await listCustomerSegments(db, shopId)).filter((s) => ext.segmentIds.includes(s.id));
  for (const s of segments) if (await customerMatchesQuery(db, shopId, customer.id, s.query)) return true;
  return false;
}

/** Trim, drop blanks and case-insensitive duplicates, cap the length and count. */
export function cleanTags(tags: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 255);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, 250);
}
