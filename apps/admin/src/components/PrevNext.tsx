import { Button, ButtonGroup } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router';
import { gql } from '../api';
import { COLLECTIONS, PRODUCTS } from '../graphql';
import { useT } from '../i18n';

const DOCS = {
  products: { doc: PRODUCTS, vars: { first: 100, sortKey: 'UPDATED_AT', reverse: true }, root: 'products', path: '/products' },
  collections: { doc: COLLECTIONS, vars: { first: 100 }, root: 'collections', path: '/collections' },
} as const;

/** Previous / next record arrows in the page header; the order is the one of the list's default view. */
export function PrevNext({ kind, gid }: { kind: keyof typeof DOCS; gid: string }) {
  const t = useT();
  const nav = useNavigate();
  const d = DOCS[kind];
  const ids = useQuery({
    queryKey: ['siblings', kind], staleTime: 30_000,
    queryFn: async () => ((await gql<Record<string, { nodes: Array<{ id: string }> }>>(d.doc, d.vars))[d.root]?.nodes ?? []).map((n) => n.id),
  });
  const list = ids.data ?? [];
  const i = list.indexOf(gid);
  const go = (to: number) => { const id = list[to]; if (id) nav(`${d.path}/${id.split('/').pop()}`); };
  return (
    <ButtonGroup>
      <Button icon aria-label={t('nav.previousRecord')} disabled={i <= 0} onClick={() => go(i - 1)}><ChevronUp className="size-4" /></Button>
      <Button icon aria-label={t('nav.nextRecord')} disabled={i < 0 || i >= list.length - 1} onClick={() => go(i + 1)}><ChevronDown className="size-4" /></Button>
    </ButtonGroup>
  );
}
