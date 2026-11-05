import { Badge, Banner, Card, RichTextEditor, Skeleton, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, Mail, Scale, Truck, Undo2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { LinkRow, RowCard, Section, SubHeader } from '../../components/SettingsKit';
import { SaveBar } from '../../components/SaveBar';
import { COOKIE_BANNER, COOKIE_BANNER_UPDATE, SHOP_POLICIES, SHOP_POLICY_UPDATE } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';

const TYPES = ['REFUND_POLICY', 'PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'SHIPPING_POLICY', 'CONTACT_INFORMATION'] as const;
const ICONS: Record<(typeof TYPES)[number], ComponentType<{ className?: string }>> = { REFUND_POLICY: Undo2, PRIVACY_POLICY: Lock, TERMS_OF_SERVICE: Scale, SHIPPING_POLICY: Truck, CONTACT_INFORMATION: Mail };
interface Policy { id: string; type: string; title: string; body: string; url: string | null }
const usePolicies = () => useQuery({ queryKey: ['shop-policies'], queryFn: () => gql<{ shop: { shopPolicies: Policy[] } }>(SHOP_POLICIES) });
const isSet = (p?: Policy) => !!p && p.body.replace(/<[^>]*>/g, '').trim().length > 0;

export function PoliciesSettings() {
  const { t } = useI18n();
  const q = usePolicies();
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('policies.written')} description={t('policies.footer')}>
        {q.isLoading && <Skeleton className="h-64" />}
        {q.error && <Banner>{q.error.message}</Banner>}
        {q.data && (
          <RowCard>
            {TYPES.map((k) => {
              const set = isSet(q.data.shop.shopPolicies.find((p) => p.type === k));
              return <LinkRow key={k} to={`/settings/policies/${k}`} icon={ICONS[k]} title={t(`policies.${k}` as Key)} trailing={<Badge tone={set ? 'success' : 'neutral'}>{t(set ? 'policies.published' : 'policies.notSet')}</Badge>} />;
            })}
          </RowCard>
        )}
      </Section>
      <CookieBanner />
    </div>
  );
}

export function PolicyEditPage() {
  const { type = '' } = useParams();
  const { t } = useI18n();
  const q = usePolicies();
  if (!(TYPES as readonly string[]).includes(type)) return <Banner>{t('notif.notFound')}</Banner>;
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Banner>{q.error.message}</Banner>;
  return <PolicyForm key={q.dataUpdatedAt} type={type as (typeof TYPES)[number]} policy={q.data?.shop.shopPolicies.find((p) => p.type === type)} />;
}

function PolicyForm({ type, policy }: { type: (typeof TYPES)[number]; policy?: Policy }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = policy?.body ?? '';
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => mutate(SHOP_POLICY_UPDATE, { shopPolicy: { type, body } }, 'shopPolicyUpdate'),
    onSuccess: () => { toast(t('policies.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['shop-policies'] }); },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });
  const rte = { bold: t('rte.bold'), italic: t('rte.italic'), underline: t('rte.underline'), list: t('rte.list'), orderedList: t('rte.orderedList'), link: t('rte.link'), source: t('rte.source'), paragraph: t('rte.paragraph'), heading: t('rte.heading'), subheading: t('rte.subheading'), linkPrompt: t('rte.linkPrompt') };
  const url = policy?.url;
  return (
    <>
      <SaveBar dirty={body !== initial} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => { setBody(initial); setError(null); }} />
      <SubHeader back="/settings/policies" parent={t('settings.policies')} title={t(`policies.${type}` as Key)}
        actions={url && body === initial && isSet(policy) ? <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary"><FileText className="size-4" />{t('policies.view')}</a> : undefined} />
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      <Card><RichTextEditor value={body} onChange={setBody} labels={rte} /></Card>
    </>
  );
}

function CookieBanner() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cookie-banner'], retry: false, queryFn: () => gql<{ shop: { cookieBanner: { enabled: boolean; message: string } } }>(COOKIE_BANNER) });
  const toggle = useMutation({
    mutationFn: (v: boolean) => mutate(COOKIE_BANNER_UPDATE, { input: { cookieBannerEnabled: v } }, 'shopmeShopUpdate'),
    onSuccess: () => { toast(t('settings.saved')); void qc.invalidateQueries({ queryKey: ['cookie-banner'] }); }, onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <Section title={t('policies.cookies')} description={t('policies.cookiesHelp')}>
      <Card>
        {q.error ? <Banner>{q.error.message}</Banner> : <Switch checked={toggle.isPending ? !!toggle.variables : !!q.data?.shop.cookieBanner.enabled} onChange={(v) => toggle.mutate(v)} label={t('policies.cookiesEnable')} />}
      </Card>
    </Section>
  );
}
