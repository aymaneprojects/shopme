import { Banner, Button, Skeleton } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n';
import { emailErrorText, storeEmailApi } from '../lib/emailApi';
import { DnsLines } from './EmailSetup';

/** Optional last step of the first-store setup: the same 3 DNS lines as Settings > E-mails, which can be skipped. */
export function EmailPanelLite({ onDone }: { onDone: () => void; email?: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['email', 'store', 'settings'], queryFn: () => storeEmailApi.settings(), retry: false });
  return (
    <div className="flex flex-col gap-4" data-testid="setup-email">
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner tone="info">{emailErrorText(q.error)}</Banner>}
      {q.data && (q.data.sendingDomain ? <DnsLines api={storeEmailApi} view={q.data} /> : <Banner tone="info">{t('setup.email.noDomain')}</Banner>)}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="plain" onClick={onDone}>{t('setup.email.skip')}</Button>
        <Button variant="primary" onClick={onDone}>{t('setup.email.continue')}</Button>
      </div>
    </div>
  );
}
