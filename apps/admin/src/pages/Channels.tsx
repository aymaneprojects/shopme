import { Badge, Banner, Button, Card, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Globe, Store, UserCog } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { gql, mutate } from '../api';
import { LearnMore } from '../components/LearnMore';
import { PageHeader } from '../components/PageHeader';
import { useFormat } from '../components/shared';
import { CHANNELS, CHANNEL_PUBLISH_ALL } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { useShop } from '../session';

interface Channel { handle: string; kind: string; active: boolean; products: number; publishedProducts: number; orders: number; sales: string }

const ICON: Record<string, ReactNode> = { 'online-store': <Store className="size-5" />, 'draft-orders': <FilePlus2 className="size-5" />, manual: <UserCog className="size-5" /> };

/** The ways orders reach the shop. The online store publishes the catalog; the others are staff-entered sources with their results. */
export function ChannelsPage() {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { shop } = useShop();
  const q = useQuery({ queryKey: ['channels'], queryFn: () => gql<{ shopmeSalesChannels: Channel[] }>(CHANNELS) });
  const publish = useMutation({
    mutationFn: ({ handle, publish: on }: { handle: string; publish: boolean }) => mutate<{ changed: number }>(CHANNEL_PUBLISH_ALL, { handle, publish: on }, 'shopmeSalesChannelPublishAll'),
    onSuccess: (r, v) => { toast(t(v.publish ? 'btn.channels.published' : 'btn.channels.unpublished', { n: r.changed })); void qc.invalidateQueries({ queryKey: ['channels'] }); void qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e: Error) => toast(e.message, 'critical'),
  });
  return (
    <>
      <PageHeader back="/" icon={<Globe className="size-4" />} title={t('nav.salesChannels')} />
      {q.isError && <Banner>{(q.error as Error).message}</Banner>}
      <div className="grid gap-4">
        {q.isLoading && <Skeleton className="h-32" />}
        {(q.data?.shopmeSalesChannels ?? []).map((c) => {
          const store = c.kind === 'storefront';
          const allOn = store && c.products > 0 && c.publishedProducts >= c.products;
          return (
            <Card key={c.handle}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface text-muted" aria-hidden>{ICON[c.handle]}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 text-[15px] font-semibold">{t(`btn.channels.${c.handle}` as Key)}<Badge tone={c.active ? 'success' : 'neutral'}>{t(c.active ? 'btn.channels.active' : 'btn.channels.inactive')}</Badge></h2>
                  <p className="mt-0.5 text-[13px] text-muted">{t(`btn.channels.${c.handle}.body` as Key)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                    <div><dt className="text-muted">{t('nav.orders')}</dt><dd className="font-medium tabular-nums">{c.orders}</dd></div>
                    <div><dt className="text-muted">{t('btn.stat.sales')}</dt><dd className="font-medium tabular-nums">{fmt.money({ amount: c.sales, currencyCode: shop.currency })}</dd></div>
                    {store && <div><dt className="text-muted">{t('btn.channels.catalog')}</dt><dd className="font-medium tabular-nums">{t('btn.channels.catalogValue', { published: c.publishedProducts, total: c.products })}</dd></div>}
                  </dl>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {store && <Switch checked={allOn} onChange={(v) => publish.mutate({ handle: c.handle, publish: v })} label={t('btn.channels.publishAll')} placement="end" />}
                  {store && <Link to="/online-store" className="text-[13px] text-accent underline">{t('btn.channels.manageTheme')}</Link>}
                  {c.kind === 'draft' && <Link to="/orders/drafts" className="text-[13px] text-accent underline">{t('nav.drafts')}</Link>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <LearnMore topic={t('btn.learn.channels')} />
    </>
  );
}
