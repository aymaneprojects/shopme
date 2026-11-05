/** The customer search syntax (`field:value`, `field:>3`, `-tag:vip`), for the query bar above the customer list. */
export interface QueryField { key: string; kind: 'text' | 'number' | 'date' | 'bool' | 'enum'; values?: readonly string[] }

export const CUSTOMER_FIELDS: readonly QueryField[] = [
  { key: 'email', kind: 'text' }, { key: 'first_name', kind: 'text' }, { key: 'last_name', kind: 'text' }, { key: 'phone', kind: 'text' }, { key: 'id', kind: 'number' },
  { key: 'tag', kind: 'text' }, { key: 'country', kind: 'text' }, { key: 'language', kind: 'text' }, { key: 'orders_count', kind: 'number' }, { key: 'amount_spent', kind: 'number' },
  { key: 'accepts_marketing', kind: 'bool' }, { key: 'verified_email', kind: 'bool' }, { key: 'tax_exempt', kind: 'bool' }, { key: 'company', kind: 'text' },
  { key: 'email_subscription', kind: 'enum', values: ['subscribed', 'not_subscribed', 'pending', 'unsubscribed'] }, { key: 'sms_subscription', kind: 'enum', values: ['subscribed', 'not_subscribed', 'pending', 'unsubscribed'] },
  { key: 'state', kind: 'enum', values: ['disabled', 'invited', 'enabled', 'declined'] }, { key: 'created_at', kind: 'date' }, { key: 'updated_at', kind: 'date' }, { key: 'last_order_at', kind: 'date' },
  { key: 'abandoned_checkout_in_last', kind: 'text' },
];

export interface QueryProblem { token: string; message: 'unknownField' | 'badNumber' | 'badDate' | 'badBool' | 'badValue' | 'empty' }

/** Split a query into tokens, keeping `field:"quoted value"` together. */
export const tokenize = (q: string): string[] => q.match(/-?[A-Za-z_]+:(?:"[^"]*"|\S*)|"[^"]*"|\S+/g) ?? [];

const OP = /^(?:<=|>=|<|>|=)?/;

/** Check each `field:value` token against the fields of the customer search. Free text is always accepted. */
export function validateCustomerQuery(q: string): QueryProblem[] {
  const out: QueryProblem[] = [];
  for (const tok of tokenize(q)) {
    const m = /^-?([A-Za-z_]+):(.*)$/.exec(tok);
    if (!m) continue;
    const field = CUSTOMER_FIELDS.find((f) => f.key === m[1]!.toLowerCase());
    const raw = m[2]!.replace(/^"|"$/g, '');
    if (!field) { out.push({ token: tok, message: 'unknownField' }); continue; }
    if (raw === '') { out.push({ token: tok, message: 'empty' }); continue; }
    const value = raw.replace(OP, '');
    if (field.kind === 'number' && !Number.isFinite(Number(value))) out.push({ token: tok, message: 'badNumber' });
    else if (field.kind === 'date' && Number.isNaN(Date.parse(value))) out.push({ token: tok, message: 'badDate' });
    else if (field.kind === 'bool' && value !== 'true' && value !== 'false') out.push({ token: tok, message: 'badBool' });
    else if (field.kind === 'enum' && !field.values!.includes(value.toLowerCase())) out.push({ token: tok, message: 'badValue' });
  }
  return out;
}

/** Field names that start with what is being typed in the last token (for suggestions). */
export function suggestFields(q: string): string[] {
  const last = q.split(/\s+/).pop() ?? '';
  if (!last || last.includes(':')) return [];
  const prefix = last.replace(/^-/, '').toLowerCase();
  return CUSTOMER_FIELDS.map((f) => f.key).filter((k) => k.startsWith(prefix) && k !== prefix);
}
