import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** Quote a value for the search syntax: `vendor:"Acme Inc"`. */
export const q = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

export interface Connection<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor?: string | null; endCursor?: string | null } }
export const flattenStrings = (c?: { edges: Array<{ node: string }> }) => c?.edges.map((e) => e.node) ?? [];
