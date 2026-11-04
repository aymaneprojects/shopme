/** `gid://shopify/Product/123` -> `123` (used for routes). */
export const gidToNum = (gid: string) => gid.split('/').pop() ?? gid;
export const numToGid = (type: string, n: string) => (n.startsWith('gid://') ? n : `gid://shopify/${type}/${n}`);

export const formatMoney = (amount: string | number | null | undefined, currency: string, locale?: string) => {
  const n = Number(amount ?? 0);
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n); } catch { return `${n.toFixed(2)} ${currency}`; }
};

/** Parse a decimal typed by a user ("12,5" or "12.5"); returns null when empty/invalid. */
export const parseDecimal = (s: string): number | null => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? null : n;
};
export const toDecimalString = (n: number | null) => (n === null ? null : n.toFixed(2));
