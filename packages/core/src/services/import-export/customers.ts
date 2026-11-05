import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { customers } from '../../db/schema';
import type { Db } from '../../db/client';
import { createCustomer, updateCustomer, type CustomerInput } from '../customers/customers';
import { getDefaultAddress } from '../customers/customers';
import { getShop } from '../shops';
import { csvLine } from '../csv';
import { decimal, lowerKeys, parseBool, splitTags, type CsvRow, type ImportEnv, type Reporter } from './common';

export const CUSTOMER_COLUMNS = [
  'Customer ID', 'First Name', 'Last Name', 'Email', 'Accepts Email Marketing', 'Default Address Company', 'Default Address Address1', 'Default Address Address2',
  'Default Address City', 'Default Address Province Code', 'Default Address Country Code', 'Default Address Zip', 'Default Address Phone', 'Phone',
  'Accepts SMS Marketing', 'Total Spent', 'Total Orders', 'Tags', 'Note', 'Tax Exempt',
];

/** Import customers, upserted by email (or phone when there is no email). */
export async function importCustomers(env: ImportEnv, rows: AsyncIterable<CsvRow>, rep: Reporter): Promise<void> {
  const { db, shopId } = env;
  let n = 0;
  for await (const { line, row } of rows) {
    n++;
    const r = lowerKeys(row);
    const email = (r['email'] ?? '').toLowerCase();
    const phone = r['phone'] || r['default address phone'] || '';
    if (!email && !phone && !r['first name'] && !r['last name']) { rep.error('A name, phone number, or email address must be present', line); rep.count('skipped'); continue; }
    const input: CustomerInput = {
      email: email || null, firstName: r['first name'] || null, lastName: r['last name'] || null, phone: r['phone'] || null,
      ...('tags' in r && { tags: splitTags(r['tags']) }), ...('note' in r && { note: r['note'] || null }),
    };
    const marketing = parseBool(r['accepts email marketing']); if (marketing !== undefined) input.acceptsMarketing = marketing;
    const exempt = parseBool(r['tax exempt']); if (exempt !== undefined) input.taxExempt = exempt;
    if (r['default address address1'] || r['default address city'] || r['default address zip']) {
      input.addresses = [{
        firstName: input.firstName, lastName: input.lastName, company: r['default address company'] || null, address1: r['default address address1'] || null, address2: r['default address address2'] || null,
        city: r['default address city'] || null, provinceCode: r['default address province code'] || r['default address province'] || null, zip: r['default address zip'] || null,
        countryCode: r['default address country code'] || r['default address country'] || null, phone: r['default address phone'] || null,
      }];
    }
    try {
      const [existing] = email ? await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, email)))
        : phone ? await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shopId), eq(customers.phone, phone))) : [];
      if (env.dryRun) {
        // Same validation as a write, without writing: only creation can be rejected up front.
        if (!existing && input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) { rep.error('email: Email is invalid', line); rep.count('failed'); } else rep.count(existing ? 'updated' : 'created');
      } else {
        const res = existing ? await updateCustomer(db, shopId, existing.id, input) : await createCustomer(db, shopId, input);
        if (res.ok) rep.count(existing ? 'updated' : 'created');
        else { for (const e of res.errors) rep.error(`${e.field?.join('.') ?? 'customer'}: ${e.message}`, line); rep.count('failed'); }
      }
    } catch (e) { rep.error(e instanceof Error ? e.message : String(e), line); rep.count('failed'); }
    await rep.progress(n, null, 'customers');
  }
}

export async function* exportCustomers(db: Db, shopId: number, ids: number[] | null = null): AsyncGenerator<string> {
  const currency = (await getShop(db, shopId))?.currency ?? 'USD';
  yield csvLine(CUSTOMER_COLUMNS);
  let after = 0;
  for (;;) {
    const batch = await db.select().from(customers).where(and(eq(customers.shopId, shopId), gt(customers.id, after), ids ? inArray(customers.id, ids) : undefined)).orderBy(asc(customers.id)).limit(200);
    if (!batch.length) return;
    after = batch.at(-1)!.id;
    for (const c of batch) {
      const a = await getDefaultAddress(db, shopId, c);
      yield csvLine([
        c.id, c.firstName ?? '', c.lastName ?? '', c.email ?? '', c.acceptsMarketing ? 'yes' : 'no', a?.company ?? '', a?.address1 ?? '', a?.address2 ?? '', a?.city ?? '', a?.provinceCode ?? '',
        a?.countryCode ?? '', a?.zip ?? '', a?.phone ?? '', c.phone ?? '', 'no', decimal(c.amountSpent, currency), c.numberOfOrders, c.tags.join(', '), c.note ?? '', c.taxExempt ? 'yes' : 'no',
      ]);
    }
  }
}
