/** URL handle helpers (products, collections, pages ... have per-shop unique handles). */
export function slugify(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'item';
}

/** Returns `base`, or `base-2`, `base-3`... the first one for which `exists` is false. */
export async function uniqueHandle(base: string, exists: (handle: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  for (let i = 2; await exists(candidate); i++) candidate = `${root}-${i}`;
  return candidate;
}
