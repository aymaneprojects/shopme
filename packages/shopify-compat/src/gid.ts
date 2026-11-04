/** Global ID helpers. IDs are `gid://shopify/<Type>/<id>`; the prefix is an interop convention, not an affiliation. */
const GID_RE = /^gid:\/\/shopify\/([A-Za-z][A-Za-z0-9]*)\/(\d+)(?:\?.*)?$/;

export interface ParsedGid {
  type: string;
  id: number;
}

export function toGid(type: string, id: number | string | bigint): string {
  return `gid://shopify/${type}/${id}`;
}

/** Parse a GID. Returns null when malformed or when `expectedType` is given and differs. */
export function fromGid(gid: string, expectedType?: string): ParsedGid | null {
  const m = GID_RE.exec(gid);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id)) return null;
  const type = m[1]!;
  if (expectedType && type !== expectedType) return null;
  return { type, id };
}

/** Lenient: accepts a full GID (type checked) or a bare numeric id string. */
export function parseId(value: string, expectedType: string): number | null {
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return fromGid(value, expectedType)?.id ?? null;
}
