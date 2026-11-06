/** SPF (RFC 7208) helpers: a domain may publish only one `v=spf1` record, so adding a sender means merging into it. */

export interface SpfAdd { ip4?: string[]; ip6?: string[]; include?: string[] }
export interface SpfMerge {
  /** The record to publish. */
  value: string;
  /** False when the existing record already authorises everything asked. */
  changed: boolean;
  /** Existing `v=spf1` records found (more than one is invalid). */
  existingCount: number;
  /** Problems the merchant should know about, as codes. */
  problems: Array<'multiple' | 'redirect' | 'permissive' | 'neutral' | 'lookups'>;
}

export const isSpf = (txt: string) => /^v=spf1(\s|$)/i.test(txt.trim());

const mech = (a: SpfAdd): string[] => [...(a.ip4 ?? []).map((i) => `ip4:${i}`), ...(a.ip6 ?? []).map((i) => `ip6:${i}`), ...(a.include ?? []).map((i) => `include:${i}`)];
const LOOKUP = /^[+\-~?]?(include|a|mx|ptr|exists|redirect)\b/i;

/** Terms of an SPF record without the version tag. */
export const spfTerms = (rec: string) => rec.trim().split(/\s+/).slice(1).filter(Boolean);

/** Whether `terms` contain the mechanism `m` as written (case-insensitive, optional `+`). */
const has = (terms: string[], m: string) => terms.some((t) => t.replace(/^\+/, '').toLowerCase() === m.toLowerCase());

/**
 * Merge `add` into the existing SPF record(s) of a domain. New mechanisms go before the final `all` term (kept as the merchant
 * wrote it); an existing mechanism is never duplicated. With no existing record a fresh one ending in `~all` is built.
 */
export function mergeSpf(existing: string[], add: SpfAdd): SpfMerge {
  const records = existing.filter(isSpf);
  const wanted = mech(add);
  const problems: SpfMerge['problems'] = [];
  if (records.length > 1) problems.push('multiple');
  if (!records.length) return { value: ['v=spf1', ...wanted, '~all'].join(' '), changed: true, existingCount: 0, problems };
  const terms = spfTerms(records[0]!);
  const redirect = terms.find((t) => /^redirect=/i.test(t));
  const allIdx = terms.findIndex((t) => /^[+\-~?]?all$/i.test(t));
  if (redirect && allIdx < 0) problems.push('redirect');
  if (allIdx >= 0) { const q = terms[allIdx]!; if (q === 'all' || q === '+all') problems.push('permissive'); else if (q === '?all') problems.push('neutral'); }
  const missing = wanted.filter((m) => !has(terms, m));
  const body = allIdx >= 0 ? terms.slice(0, allIdx) : terms.filter((t) => t !== redirect);
  const tail = allIdx >= 0 ? terms.slice(allIdx) : ['~all'];
  const merged = [...body, ...missing, ...tail];
  if (merged.filter((t) => LOOKUP.test(t)).length >= 9) problems.push('lookups');
  return { value: ['v=spf1', ...merged].join(' '), changed: missing.length > 0 || records.length > 1 || (!!redirect && allIdx < 0), existingCount: records.length, problems };
}

/** Does `record` contain every mechanism in `add`? (IPs and includes are matched literally; nothing is resolved.) */
export function spfCovers(record: string, add: SpfAdd): boolean {
  const terms = spfTerms(record);
  return mech(add).every((m) => has(terms, m));
}
