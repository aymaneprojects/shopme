import { cx } from '@shopme/ui';
import { Check, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { GUIDE_ART } from '../../assets/home/illustrations';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { TASK_IDS, countDone, orderTasks, readGuideHidden, writeGuideHidden } from '../../lib/home';
import type { TaskId } from '../../lib/home';

const TARGET: Record<Exclude<TaskId, 'launch'>, string> = {
  payments: '/settings/payments', domain: '/settings/domains', email: '/settings/emails', product: '/products/new', theme: '/online-store', shipping: '/settings/shipping', backup: '/settings/backup',
};
const outline = 'inline-flex h-8 items-center justify-center self-start rounded-full border border-line bg-canvas px-3.5 text-[13px] font-medium hover:bg-hover';

/** Circular progress: the arc is the share of tasks done. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative size-24 shrink-0" aria-hidden>
      <svg viewBox="0 0 84 84" className="size-full -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-border)" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-accent)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - (total ? done / total : 0))} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-semibold tabular-nums">{done}/{total}</span>
    </div>
  );
}

function TaskCard({ id, done, launchable, onLaunch, storeUrl }: { id: TaskId; done: boolean; launchable: boolean; onLaunch: () => void; storeUrl: string }) {
  const { t } = useI18n();
  const Art = GUIDE_ART[id];
  const label = done && id !== 'launch' ? t('hm.guide.review') : t(`hm.task.${id}.cta` as Key);
  return (
    <li data-task={id} data-done={done} className={cx('flex flex-col overflow-hidden rounded-2xl border border-line bg-canvas p-2 shadow-card', done && 'bg-surface/50')}>
      <div className={cx('relative h-[140px] overflow-hidden rounded-xl bg-surface p-2', done && 'opacity-60')}><Art /></div>
      <div className="flex flex-1 flex-col gap-1 px-2 pb-2 pt-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {done && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success-subtle text-success" role="img" aria-label={t('hm.guide.done')}><Check className="size-3.5" aria-hidden /></span>}
          <span className={cx(done && 'text-muted line-through decoration-1')}>{t(`hm.task.${id}` as Key)}</span>
        </h3>
        <p className="text-[13px] leading-5 text-muted">{t(`hm.task.${id}.body` as Key)}</p>
        <div className="mt-auto pt-3">
          {id === 'launch'
            ? done ? <a href={storeUrl} target="_blank" rel="noreferrer" className={outline}>{t('home.viewStore')}</a>
              : <button type="button" className={outline} onClick={onLaunch} disabled={!launchable}>{label}</button>
            : <Link to={TARGET[id]} className={outline}>{label}</Link>}
        </div>
      </div>
    </li>
  );
}

/**
 * The getting-started guide: one card per task with the pending ones first, a progress card, and a hide link that leaves a small
 * "show setup guide" link behind (the choice is remembered in this browser).
 */
export function SetupGuide({ shopId, done, onLaunch, launchable = true, storeUrl }: { shopId: number | string; done: Record<TaskId, boolean>; onLaunch: () => void; launchable?: boolean; storeUrl: string }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(() => readGuideHidden(shopId));
  const set = (v: boolean) => { setHidden(v); writeGuideHidden(shopId, v); };
  const n = countDone(done), total = TASK_IDS.length;
  if (hidden) {
    return <div className="mt-8"><button type="button" onClick={() => set(false)} className="text-[13px] font-medium text-accent underline underline-offset-2">{t('hm.guide.show')}</button></div>;
  }
  return (
    <section aria-labelledby="home-guide-title" className="mt-8">
      <h2 id="home-guide-title" className="sr-only">{t('hm.guide.title')}</h2>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li data-testid="guide-progress" className="flex flex-col justify-between gap-4 rounded-2xl border border-line bg-canvas p-5 shadow-card">
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <Ring done={n} total={total} />
            <div className="min-w-0">
              <p className="text-base font-semibold" role="status">{t('hm.guide.progress', { done: n, total, $count: n })}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{n === total ? t('hm.guide.allDone') : t('hm.guide.intro')}</p>
            </div>
          </div>
          <button type="button" onClick={() => set(true)} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:underline"><EyeOff className="size-3.5" aria-hidden />{t('hm.guide.hide')}</button>
        </li>
        {orderTasks(done).map((id) => <TaskCard key={id} id={id} done={done[id]} launchable={launchable} onLaunch={onLaunch} storeUrl={storeUrl} />)}
      </ul>
    </section>
  );
}
