import { cx } from '@shopme/ui';
import { Link } from 'react-router';
import { GUIDE_ART } from '../../assets/home/illustrations';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { TASK_IDS, countDone, orderTasks } from '../../lib/home';
import type { TaskId } from '../../lib/home';

const TARGET: Record<Exclude<TaskId, 'launch'>, string> = {
  payments: '/settings/payments', domain: '/settings/domains', email: '/settings/emails', product: '/products/new', theme: '/online-store', shipping: '/settings/shipping', backup: '/settings/backup',
};
const outline = 'inline-flex h-8 items-center justify-center self-start rounded-full border border-line bg-canvas px-3.5 text-[13px] font-medium hover:bg-hover';

function Card({ id, testId, title, body, badge, children }: { id: TaskId; testId?: string; title: string; body: string; badge?: string; children: React.ReactNode }) {
  const Art = GUIDE_ART[id];
  return (
    <li data-task={id} data-testid={testId} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-canvas p-1.5 shadow-card">
      <div className="relative h-[116px] overflow-hidden rounded-xl bg-surface p-2"><Art />
        {badge && <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-medium text-white" role="status"><span className="size-3 rounded-full border-2 border-white/80 border-t-transparent" aria-hidden />{badge}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2.5 pb-2.5 pt-3">
        <h3 className="text-sm font-medium leading-5">{title}</h3>
        <p className="text-[13px] leading-5 text-muted">{body}</p>
        <div className="mt-auto pt-4">{children}</div>
      </div>
    </li>
  );
}

/**
 * The getting-started guide: one card per pending task (finished ones are not listed), and a last card that shows how many tasks are
 * done and resumes with the next one.
 */
export function SetupGuide({ done, onLaunch, launchable = true }: { done: Record<TaskId, boolean>; onLaunch: () => void; launchable?: boolean }) {
  const { t } = useI18n();
  const n = countDone(done), total = TASK_IDS.length;
  const pending = orderTasks(done).filter((id) => !done[id]);
  const next = pending[pending.length - 1];
  const listed = pending.slice(0, -1);
  const action = (id: TaskId, label: string) => id === 'launch'
    ? <button type="button" className={outline} onClick={onLaunch} disabled={!launchable}>{label}</button>
    : <Link to={TARGET[id]} className={outline}>{label}</Link>;
  return (
    <section aria-labelledby="home-guide-title" className="mx-auto mt-8 max-w-[780px]">
      <h2 id="home-guide-title" className="sr-only">{t('hm.guide.title')}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {listed.map((id) => <Card key={id} id={id} title={t(`hm.task.${id}` as Key)} body={t(`hm.task.${id}.body` as Key)}>{action(id, t(`hm.task.${id}.cta` as Key))}</Card>)}
        {next
          ? <Card id={next} testId="guide-progress" badge={t('hm.guide.progress', { done: n, total, $count: n })} title={t(`hm.task.${next}` as Key)} body={t('hm.guide.next', { task: t(`hm.task.${next}` as Key) })}>{action(next, t('hm.guide.resume'))}</Card>
          : <li data-testid="guide-progress" className="flex flex-col gap-1 rounded-2xl border border-line bg-canvas p-5 shadow-card"><p className="text-sm font-medium" role="status">{t('hm.guide.progress', { done: n, total, $count: n })}</p><p className="text-[13px] text-muted">{t('hm.guide.allDone')}</p></li>}
      </ul>
    </section>
  );
}
