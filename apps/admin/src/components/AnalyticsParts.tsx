import { Banner, Button, Card, Input, Modal, Select, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { UserErrors, gql, mutate } from '../api';
import { ANNOTATIONS, ANNOTATION_CREATE, ANNOTATION_DELETE, GOALS, GOAL_DELETE, GOAL_SET } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { formatReportQuery, parseReportQuery } from '../lib/report-query';
import type { ReportQuery } from '../lib/report-query';
import { useShop } from '../session';

const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

/* ------------------------------ goals ------------------------------ */

export const GOAL_METRICS = ['TOTAL_SALES', 'ORDERS', 'AVERAGE_ORDER_VALUE', 'SESSIONS'] as const;
export const GOAL_PERIODS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export interface GoalRow { id: string; metric: (typeof GOAL_METRICS)[number]; period: (typeof GOAL_PERIODS)[number]; target: number; actual: number; from: string; to: string; elapsed: number }
const isMoney = (m: string) => m === 'TOTAL_SALES' || m === 'AVERAGE_ORDER_VALUE';
const digitsOf = (currency: string, lang: string) => { try { return new Intl.NumberFormat(lang, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };

export const useGoals = () => useQuery({ queryKey: ['analytics-goals'], queryFn: async () => (await gql<{ shopmeGoals: GoalRow[] }>(GOALS)).shopmeGoals });

/** Format a goal figure: money metrics are in minor units of the shop currency. */
export function useGoalFormat() {
  const { lang } = useI18n();
  const { shop } = useShop();
  return useMemo(() => {
    const d = digitsOf(shop.currency, lang);
    const money = new Intl.NumberFormat(lang, { style: 'currency', currency: shop.currency });
    const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
    return { digits: d, show: (metric: string, v: number) => (isMoney(metric) ? money.format(v / 10 ** d) : num.format(v)) };
  }, [lang, shop.currency]);
}

/** Dialog to set, change and remove the targets shown on the analytics overview. */
export function GoalsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useGoalFormat();
  const goals = useGoals();
  const [metric, setMetric] = useState<GoalRow['metric']>('TOTAL_SALES');
  const [period, setPeriod] = useState<GoalRow['period']>('MONTH');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const value = Number(target.replace(',', '.'));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['analytics-goals'] }); };
  const save = useMutation({
    mutationFn: () => mutate(GOAL_SET, { metric, period, target: isMoney(metric) ? Math.round(value * 10 ** fmt.digits) : Math.round(value) }, 'shopmeGoalSet'),
    onSuccess: () => { setTarget(''); setError(null); refresh(); toast(t('bc.goal.saved')); }, onError: (e) => setError(errText(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => mutate(GOAL_DELETE, { id }, 'shopmeGoalDelete'), onSuccess: refresh, onError: (e) => toast(errText(e), 'critical') });
  // Editing a goal starts from its current target.
  const existing = goals.data?.find((g) => g.metric === metric && g.period === period);
  useEffect(() => { setTarget(existing ? String(isMoney(metric) ? existing.target / 10 ** fmt.digits : existing.target) : ''); }, [existing?.id, existing?.target, metric, period, fmt.digits]);
  return (
    <Modal open={open} onClose={onClose} title={t('bc.goal.title')} closeLabel={t('common.close')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="text-muted">{t('bc.goal.intro')}</p>
        {error && <Banner>{error}</Banner>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('bc.goal.metric')} value={metric} onChange={(e) => setMetric(e.target.value as GoalRow['metric'])}>{GOAL_METRICS.map((m) => <option key={m} value={m}>{t(`bc.goal.metric.${m}` as Key)}</option>)}</Select>
          <Select label={t('bc.goal.period')} value={period} onChange={(e) => setPeriod(e.target.value as GoalRow['period'])}>{GOAL_PERIODS.map((p) => <option key={p} value={p}>{t(`bc.goal.period.${p}` as Key)}</option>)}</Select>
          <Input label={t('bc.goal.target')} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div className="flex justify-end"><Button variant="primary" loading={save.isPending} disabled={!(value > 0)} onClick={() => save.mutate()}>{t(existing ? 'bc.goal.update' : 'bc.goal.add')}</Button></div>
        {(goals.data?.length ?? 0) > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {goals.data!.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1"><span className="font-medium">{t(`bc.goal.metric.${g.metric}` as Key)}</span> <span className="text-muted">· {t(`bc.goal.period.${g.period}` as Key)}</span></span>
                <span>{fmt.show(g.metric, g.target)}</span>
                <Button variant="plain" size="sm" icon aria-label={t('common.delete')} onClick={() => del.mutate(g.id)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Progress of each goal in its current period, with a marker for how much of the period has passed. */
export function GoalsStrip({ onEdit }: { onEdit: () => void }) {
  const { t } = useI18n();
  const fmt = useGoalFormat();
  const goals = useGoals();
  if (!goals.data?.length) return null;
  return (
    <section aria-label={t('bc.goal.title')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {goals.data.map((g) => {
        const done = g.target > 0 ? g.actual / g.target : 0;
        const state = done >= 1 ? 'reached' : done >= g.elapsed * 0.9 ? 'onTrack' : 'behind';
        return (
          <button key={g.id} type="button" onClick={onEdit} className="rounded-lg bg-canvas p-4 text-left shadow-card hover:bg-hover">
            <p className="flex items-center gap-1.5 text-[13px] text-muted"><Target className="size-3.5" />{t(`bc.goal.metric.${g.metric}` as Key)} · {t(`bc.goal.period.${g.period}` as Key)}</p>
            <p className="mt-1 text-lg font-semibold">{fmt.show(g.metric, g.actual)} <span className="text-[13px] font-normal text-muted">/ {fmt.show(g.metric, g.target)}</span></p>
            <div className="relative mt-2 h-2 rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(done * 100))} aria-label={t(`bc.goal.metric.${g.metric}` as Key)}>
              <div className={cx('h-2 rounded-full', state === 'behind' ? 'bg-attention' : 'bg-success')} style={{ width: `${Math.min(100, done * 100)}%` }} />
              <span aria-hidden className="absolute -top-0.5 h-3 w-0.5 bg-fg/60" style={{ left: `${Math.min(100, g.elapsed * 100)}%` }} />
            </div>
            <p className={cx('mt-1.5 text-xs', state === 'behind' ? 'text-attention' : 'text-success')}>{t(`bc.goal.${state}` as Key, { pct: Math.round(done * 100) })}</p>
          </button>
        );
      })}
    </section>
  );
}

/* ------------------------------ annotations ------------------------------ */

export interface AnnotationRow { id: string; day: string; text: string; reportKey: string | null }

export const useAnnotations = (reportKey: string, from: string, to: string, enabled = true) => useQuery({
  queryKey: ['analytics-annotations', reportKey, from, to], enabled,
  queryFn: async () => (await gql<{ shopmeAnnotations: AnnotationRow[] }>(ANNOTATIONS, { reportKey, from, to })).shopmeAnnotations,
});

/** The dated notes of a report: add one for a day, remove one. They are drawn on the chart. */
export function AnnotationsPanel({ reportKey, from, to }: { reportKey: string; from: string; to: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useAnnotations(reportKey, from, to);
  const [day, setDay] = useState(to);
  const [text, setText] = useState('');
  const [onlyThis, setOnlyThis] = useState(true);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['analytics-annotations'] }); };
  const add = useMutation({
    mutationFn: () => mutate(ANNOTATION_CREATE, { day, text, reportKey: onlyThis ? reportKey : null }, 'shopmeAnnotationCreate'),
    onSuccess: () => { setText(''); refresh(); }, onError: (e) => toast(errText(e), 'critical'),
  });
  const del = useMutation({ mutationFn: (id: string) => mutate(ANNOTATION_DELETE, { id }, 'shopmeAnnotationDelete'), onSuccess: refresh, onError: (e) => toast(errText(e), 'critical') });
  return (
    <Card title={t('bc.annotations.title')}>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <Input className="w-40" type="date" label={t('bc.annotations.day')} value={day} onChange={(e) => setDay(e.target.value)} />
        <Input className="min-w-48 flex-1" label={t('bc.annotations.text')} maxLength={280} value={text} placeholder={t('bc.annotations.placeholder')} onChange={(e) => setText(e.target.value)} />
        <label className="flex items-center gap-1.5 pb-2 text-[13px]"><input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} />{t('bc.annotations.onlyThis')}</label>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!text.trim() || !day}>{t('bc.annotations.add')}</Button>
      </form>
      {(q.data?.length ?? 0) === 0 ? <p className="mt-3 text-[13px] text-muted">{t('bc.annotations.none')}</p> : (
        <ul className="mt-3 divide-y divide-line text-[13px]">
          {q.data!.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-1.5"><time className="w-24 shrink-0 text-muted">{a.day}</time><span className="min-w-0 flex-1">{a.text}</span>{!a.reportKey && <span className="text-xs text-muted">{t('bc.annotations.allReports')}</span>}
              <Button variant="plain" size="sm" icon aria-label={t('common.delete')} onClick={() => del.mutate(a.id)}><Trash2 className="size-4" /></Button></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------ range slider ------------------------------ */

/** Two handles under a chart to zoom into a part of the period. `value` is [first, last] point index. */
export function RangeSlider({ length, value, onChange, labels }: { length: number; value: [number, number]; onChange: (v: [number, number]) => void; labels: [string, string] }) {
  const { t } = useI18n();
  if (length < 3) return null;
  const [lo, hi] = value;
  const full = lo === 0 && hi === length - 1;
  return (
    <div className="mt-2 flex flex-col gap-1 text-xs text-muted">
      <div className="relative h-5">
        <div aria-hidden className="absolute inset-x-0 top-2 h-1 rounded bg-surface" />
        <div aria-hidden className="absolute top-2 h-1 rounded bg-primary/40" style={{ left: `${(lo / (length - 1)) * 100}%`, right: `${100 - (hi / (length - 1)) * 100}%` }} />
        <input type="range" min={0} max={length - 1} value={lo} aria-label={t('bc.slider.start')} onChange={(e) => onChange([Math.min(Number(e.target.value), hi - 1), hi])} className="range-handle pointer-events-none absolute inset-x-0 top-0 h-5 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto" />
        <input type="range" min={0} max={length - 1} value={hi} aria-label={t('bc.slider.end')} onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo + 1)])} className="range-handle pointer-events-none absolute inset-x-0 top-0 h-5 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto" />
      </div>
      <div className="flex items-center justify-between"><span>{labels[0]}</span>{!full && <button type="button" className="text-accent hover:underline" onClick={() => onChange([0, length - 1])}>{t('bc.slider.reset')}</button>}<span>{labels[1]}</span></div>
    </div>
  );
}

/* ------------------------------ query box ------------------------------ */

/** The query of a report as text, with "Refine query" to apply an edited version. The text always mirrors the controls. */
export function QueryBox({ query, onApply }: { query: ReportQuery; onApply: (q: ReportQuery) => string | null | void }) {
  const { t } = useI18n();
  const text = formatReportQuery(query);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(text); setError(null); }, [text]);
  const apply = () => {
    const r = parseReportQuery(draft);
    if (!r.ok) { setError(t(`bc.query.error.${r.error}` as Key, { token: r.token ?? '' })); return; }
    setError(onApply(r.query) ?? null);
  };
  return (
    <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); apply(); }} aria-label={t('bc.query.label')}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('bc.query.label')} aria-invalid={!!error} spellCheck={false} placeholder="SHOW total, orders BY week SINCE last_30_days COMPARE previous_year VISUALIZE bar"
          className={cx('field-control min-w-64 flex-1 font-mono text-xs', error && 'border-critical')} />
        <Button type="submit" disabled={draft.trim() === text.trim()}>{t('bc.query.refine')}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
    </form>
  );
}
