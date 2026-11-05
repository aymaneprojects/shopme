import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ref, shopIdCol, timestamps } from './_helpers';
import { shops } from './shop';
import { customers } from './sales';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** A business customer (B2B). Its buyers are `companyContacts` (customers) and it buys for one or more `companyLocations`. */
export const companies = pgTable('companies', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  externalId: text('external_id'),
  note: text('note'),
  mainContactId: ref('main_contact_id'),
  ...timestamps(),
}, (t) => [index('companies_shop_idx').on(t.shopId, t.name), uniqueIndex('companies_external_uq').on(t.shopId, t.externalId)]);

export const companyLocations = pgTable('company_locations', {
  id: pk(), shopId: shopFk(),
  companyId: ref('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  externalId: text('external_id'),
  note: text('note'),
  taxRegistrationId: text('tax_registration_id'),
  taxExempt: boolean('tax_exempt').notNull().default(false),
  /** Payment terms in days after the order (0 = due on receipt); null = no terms (paid at checkout). */
  paymentTermsDays: integer('payment_terms_days'),
  address1: text('address1'), address2: text('address2'), city: text('city'), zip: text('zip'),
  province: text('province'), countryCode: text('country_code'),
  ...timestamps(),
}, (t) => [index('company_locations_company_idx').on(t.companyId)]);

export const companyContacts = pgTable('company_contacts', {
  id: pk(), shopId: shopFk(),
  companyId: ref('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  customerId: ref('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  title: text('title'),
  ...timestamps(),
}, (t) => [uniqueIndex('company_contacts_uq').on(t.companyId, t.customerId), index('company_contacts_customer_idx').on(t.customerId)]);
