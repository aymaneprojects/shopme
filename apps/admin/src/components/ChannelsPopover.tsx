import { Badge, Popover } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { gql } from '../api';
import { COLLECTION_PUBLICATIONS, PRODUCT_PUBLICATIONS } from '../graphql';
import { useI18n } from '../i18n';
import { useFormat } from './shared';

interface Row { isPublished: boolean; publishDate: string | null; publication: { id: string; name: string } }

function Rows({ id, kind }: { id: string; kind: 'product' | 'collection' }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useQuery({
    queryKey: ['resource-publications', id],
    queryFn: async () => {
      const d = await gql<{ product?: { resourcePublicationsV2: { nodes: Row[] } } | null; collection?: { resourcePublicationsV2: { nodes: Row[] } } | null }>(kind === 'product' ? PRODUCT_PUBLICATIONS : COLLECTION_PUBLICATIONS, { id });
      return (d.product ?? d.collection)?.resourcePublicationsV2.nodes ?? [];
    },
  });
  if (q.isLoading) return <p className="w-56 text-[13px] text-muted">{t('common.loading')}</p>;
  return (
    <ul className="flex w-64 flex-col gap-1.5 text-[13px]">
      {(q.data ?? []).map((r) => (
        <li key={r.publication.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">{r.publication.name}</span>
          {!r.isPublished ? <Badge tone="neutral">{t('bp.channels.off')}</Badge> : r.publishDate && new Date(r.publishDate) > new Date() ? <Badge tone="info">{t('bp.channels.scheduled', { date: fmt.dateTime(r.publishDate) })}</Badge> : <Badge tone="success">{t('bp.channels.on')}</Badge>}
        </li>
      ))}
    </ul>
  );
}

/** The channel count of a product / collection row; opens the list of channels it is published on. */
export function ChannelsPopover({ id, count, kind = 'product' }: { id: string; count: number; kind?: 'product' | 'collection' }) {
  const { t } = useI18n();
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-block">
      <Popover label={t('bp.channels.title')} align="right" triggerVariant="plain" triggerClassName="btn-neutral !h-7 !px-2 tabular-nums" trigger={t('bp.channels.countShort', { n: count, $count: count })}>
        {() => <Rows id={id} kind={kind} />}
      </Popover>
    </span>
  );
}
