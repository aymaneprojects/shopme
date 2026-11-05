import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** Quote a value for the search syntax: `vendor:"Acme Inc"`. */
export const q = (s: string) => `"${s.replace(/["\\]/g, '')}"`;

export interface Connection<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor?: string | null; endCursor?: string | null } }
export const flattenStrings = (c?: { edges: Array<{ node: string }> }) => c?.edges.map((e) => e.node) ?? [];

/** `/content` when a Content page is shown (Files, Menus, Blog posts live under both Content and Online store), else `/online-store`. */
export const useStoreBase = () => (useLocation().pathname.startsWith('/content') ? '/content' : '/online-store');
