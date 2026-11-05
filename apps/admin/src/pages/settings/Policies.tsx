import { Banner, Card, RichTextEditor, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../../api';
import { SaveBar } from '../../components/SaveBar';
import { COOKIE_BANNER, COOKIE_BANNER_UPDATE, SHOP_POLICIES, SHOP_POLICY_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';

const TYPES = ['REFUND_POLICY', 'PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'SHIPPING_POLICY', 'CONTACT_INFORMATION'] as const;
interface Policy { id: string; type: string; title: string; body: string; url: string | null }

export function PoliciesSettings() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['shop-policies'], queryFn: () => gql<{ shop: { shopPolicies: Policy[] } }>(SHOP_POLICIES) });
  return (
    <div className="flex flex-col gap-4">
      <CookieBanner />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <Banner>{q.error.message}</Banner>}
      {q.data && <PolicyForms key={q.dataUpdatedAt} policies={q.data.shop.shopPolicies} />}
      <p className="text-xs text-muted">{t('policies.footer')}</p>
    </div>
  );
}

function PolicyForms({ policies }: { policies: Policy[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = Object.fromEntries(TYPES.map((k) => [k, policies.find((p) => p.type === k)?.body ?? ''])) as Record<string, string>;
  const [bodies, setBodies] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const changed = TYPES.filter((k) => bodies[k] !== initial[k]);
  const save = useMutation({
    mutationFn: async () => { for (const type of changed) await mutate(SHOP_POLICY_UPDATE, { shopPolicy: { type, body: bodies[type] } }, 'shopPolicyUpdate'); },
    onSuccess: () => { toast(t('policies.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['shop-policies'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const rte = { bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') };
  return (
    <>
      <SaveBar dirty={changed.length > 0} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setBodies(initial); setError(null); }} />
      {error && <Banner>{error}</Banner>}
      {TYPES.map((k) => {
        const url = policies.find((p) => p.type === k)?.url;
        return (
          <Card key={k} title={t(`policies.${k}` as Key)} actions={url && <a href={url} target="_blank" rel="noreferrer" className="text-[13px] text-accent underline">{t('policies.view')}</a>}>
            <RichTextEditor value={bodies[k]!} onChange={(v) => setBodies((b) => ({ ...b, [k]: v }))} labels={rte} />
          </Card>
        );
      })}
    </>
  );
}

function CookieBanner() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cookie-banner'], retry: false, queryFn: () => gql<{ shop: { cookieBannerEnabled: boolean } }>(COOKIE_BANNER) });
  const toggle = useMutation({
    mutationFn: (v: boolean) => mutate(COOKIE_BANNER_UPDATE, { input: { cookieBannerEnabled: v } }, 'shopmeShopUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['cookie-banner'] }); }, onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <Card title={t('policies.cookies')}>
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-muted">{t('policies.cookiesHelp')}</p>
        {q.error ? <Banner>{q.error.message}</Banner> : <Switch checked={toggle.isPending ? !!toggle.variables : !!q.data?.shop.cookieBannerEnabled} onChange={(v) => toggle.mutate(v)} label={t('policies.cookiesEnable')} />}
      </div>
    </Card>
  );
}
