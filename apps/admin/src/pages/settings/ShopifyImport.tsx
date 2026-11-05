import { Banner, Button, Card, Input } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { rest } from '../../api';
import { JobSummary } from '../../components/CsvTools';
import { useI18n } from '../../i18n';
import { isTerminal, useJob } from '../../lib/jobs';

export function ShopifyImportSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState({ shopDomain: '', accessToken: '' });
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({ mutationFn: () => rest<{ jobId: string }>('/migrate/shopify', { body: { shopDomain: form.shopDomain.trim(), accessToken: form.accessToken.trim() } }), onSuccess: (r) => setJobId(String(r.jobId)) });
  const job = useJob(jobId);
  const finished = isTerminal(job.data);
  useEffect(() => { if (job.data?.status === 'completed') for (const k of ['products', 'customers', 'orders', 'collections']) void qc.invalidateQueries({ queryKey: [k] }); }, [job.data?.status, qc]);
  const valid = /^[a-z0-9-]+\.myshopify\.com$|^[a-z0-9.-]+\.[a-z]{2,}$/i.test(form.shopDomain.trim()) && form.accessToken.trim().length > 8;
  const error = start.error?.message ?? job.error?.message ?? (job.data?.status === 'failed' ? job.data.error ?? job.data.errors?.[0]?.message : null);
  return (
    <div className="flex flex-col gap-4">
      <Card title={t('shopify.howTitle')}>
        <ol className="list-decimal space-y-1 pl-5 text-sm">{(['1', '2', '3', '4'] as const).map((n) => <li key={n}>{t(`shopify.step${n}` as 'shopify.step1')}</li>)}</ol>
        <p className="mt-3 text-xs text-muted">{t('shopify.scopes')}</p>
      </Card>
      <Card title={t('shopify.formTitle')}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) start.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('shopify.domain')} placeholder="my-store.myshopify.com" autoComplete="off" value={form.shopDomain} onChange={(e) => setForm({ ...form, shopDomain: e.target.value })} />
            <Input label={t('shopify.token')} type="password" placeholder="shpat_…" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
          </div>
          {error && <Banner>{error}</Banner>}
          <div><Button type="submit" variant="primary" loading={start.isPending || (!!jobId && !finished && !error)} disabled={!valid}>{t('shopify.start')}</Button></div>
        </form>
      </Card>
      {jobId && <Card title={t(job.data?.status === 'completed' ? 'shopify.done' : 'shopify.running')}><JobSummary job={job.data ?? { status: 'pending', progress: 0 }} /></Card>}
    </div>
  );
}
