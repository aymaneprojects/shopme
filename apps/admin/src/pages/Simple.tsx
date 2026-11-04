import { Card, EmptyState } from '@shopme/ui';
import { Construction } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import type { Key } from '../i18n';
import { useT } from '../i18n';

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

