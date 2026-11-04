import { Badge, Card, EmptyState } from '@shopme/ui';
import { Construction, Package, ShoppingCart, TrendingUp } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import type { Key } from '../i18n';
import { useT } from '../i18n';
import { useShop } from '../session';

/** Routed placeholder for areas built in a later version. */
export function ComingSoon({ titleKey }: { titleKey: Key }) {
  const t = useT();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <Card><EmptyState icon={<Construction className="size-10" />} title={t('soon.title')} description={t('soon.body')} /></Card>
    </>
  );
}

export function HomePage() {
  const t = useT();
  const { shop, user } = useShop();
  const cards = [
    { icon: ShoppingCart, label: t('home.orders') },
    { icon: TrendingUp, label: t('home.sales') },
    { icon: Package, label: t('home.products') },
  ];
  return (
    <>
      <PageHeader title={t('home.welcome', { name: user.firstName || shop.name })} />
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} title={c.label}>
            <div className="flex items-center justify-between text-muted"><c.icon className="size-6" /><Badge>{t('home.soon')}</Badge></div>
            <p className="mt-2 text-2xl font-semibold">—</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4" title={t('home.setupTitle')}><p className="text-sm text-muted">{t('home.setupBody')}</p></Card>
    </>
  );
}
