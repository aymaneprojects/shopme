// Updates of the theme included with ShopMe (Aurora): what's new, then a new unpublished copy and what was carried over.
import { Banner, Button, Modal, Skeleton } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileCode2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { gql } from '../../api';
import { THEME_RELEASE_NOTES } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';

export interface BundledThemeStatus { handle?: string; name: string; installedVersion: string | null; bundledVersion: string; updateAvailable: boolean }
interface ReleaseNote { version: string; date: string | null; notes: string[] }
export interface ThemeUpdateResult {
  theme: { id: string; name: string; role: string } | null;
  previousVersion: string | null; version: string | null;
  carriedOverFiles: string[]; removedSettings: string[];
  skippedFiles: { filename: string; reason: 'EDITED' | 'REMOVED_IN_NEW_VERSION' | 'UNREADABLE' }[];
  removedReferences: { filename: string; kind: 'SECTION' | 'BLOCK'; id: string; type: string }[];
}

const formatDate = (iso: string | null, lang: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(d);
};

/** Confirmation with the release notes of the versions after the installed one. */
export function ThemeUpdateDialog({ themeId, status, open, busy, onClose, onConfirm }: { themeId: string; status: BundledThemeStatus; open: boolean; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t, lang } = useI18n();
  const notes = useQuery({
    queryKey: ['theme-release-notes', themeId, lang], enabled: open,
    queryFn: () => gql<{ theme: { shopmeBundledTheme: { releaseNotes: ReleaseNote[] } | null } | null }>(THEME_RELEASE_NOTES, { id: themeId, locale: lang }),
  });
  const versions = notes.data?.theme?.shopmeBundledTheme?.releaseNotes ?? [];
  const vars = { name: status.name, version: status.bundledVersion, installed: status.installedVersion ?? '?' };
  return (
    <Modal open={open} medium onClose={onClose} closeLabel={t('common.close')} title={t('themes.update.title', vars)}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={onConfirm}>{t('themes.update.confirm')}</Button></>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="text-muted">{t('themes.update.installed', vars)}</p>
        <section aria-labelledby="theme-whats-new">
          <h3 id="theme-whats-new" className="mb-2 font-semibold">{t('themes.update.whatsNew')}</h3>
          {notes.isLoading && <div aria-label={t('themes.update.loadingNotes')} className="flex flex-col gap-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>}
          {notes.error && <Banner>{notes.error.message}</Banner>}
          {versions.map((v) => (
            <div key={v.version} className="mb-3 last:mb-0">
              <p className="mb-1 font-medium">{t('themes.update.versionHeading', { version: v.version })}{v.date && <span className="font-normal text-muted"> · {formatDate(v.date, lang)}</span>}</p>
              {v.notes.length
                ? <ul className="flex list-disc flex-col gap-1 pl-5">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                : <p className="text-muted">{t('themes.update.noNotes')}</p>}
            </div>
          ))}
        </section>
        <Banner tone="info">{t('themes.update.howItWorks', vars)}</Banner>
        <p className="text-muted">{t('themes.update.codeNote')}</p>
      </div>
    </Modal>
  );
}

function Part({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1"><h3 className="mb-1 font-semibold">{title}</h3>{children}</div>
    </section>
  );
}

const FileList = ({ items }: { items: ReactNode[] }) => <ul className="mt-1 flex flex-col gap-1">{items}</ul>;

/** What the update did: the new theme, what was carried over, and what the merchant should look at. */
export function ThemeUpdateResultDialog({ result, onClose, onCustomize }: { result: ThemeUpdateResult | null; onClose: () => void; onCustomize: (themeId: string) => void }) {
  const { t } = useI18n();
  const name = result?.theme?.name ?? '';
  const edited = result?.skippedFiles ?? [];
  const removed = result?.removedReferences ?? [];
  const settings = result?.removedSettings ?? [];
  const carried = result?.carriedOverFiles ?? [];
  const attention = edited.length + removed.length + settings.length > 0;
  return (
    <Modal open={!!result} medium onClose={onClose} closeLabel={t('common.close')} title={t('themes.update.done', { name })}
      footer={<><Button onClick={onClose}>{t('common.close')}</Button>{result?.theme && <Button variant="primary" onClick={() => onCustomize(result.theme!.id)}>{t('themes.update.customize')}</Button>}</>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <Banner tone="success">{t('themes.update.doneBody', { name })}</Banner>
        <Part icon={<CheckCircle2 className="text-success" />} title={carried.length ? t('themes.update.carried', { n: carried.length }) : t('themes.update.carriedNone')}>
          {carried.length > 0 && (
            <details className="text-muted">
              <summary className="cursor-pointer select-none">{t('themes.update.showFiles')}</summary>
              <FileList items={carried.map((f) => <li key={f}><code className="text-[12px]">{f}</code></li>)} />
            </details>
          )}
        </Part>
        {edited.length > 0 && (
          <Part icon={<FileCode2 className="text-attention" />} title={t('themes.update.edited')}>
            <p className="text-muted">{t('themes.update.editedBody')}</p>
            <FileList items={edited.map((f) => (
              <li key={f.filename} className="flex flex-wrap items-baseline gap-x-2"><code className="text-[12px] font-medium">{f.filename}</code><span className="text-muted">{t(`themes.update.reason.${f.reason}` as Key)}</span></li>
            ))} />
          </Part>
        )}
        {removed.length > 0 && (
          <Part icon={<AlertTriangle className="text-attention" />} title={t('themes.update.removed')}>
            <p className="text-muted">{t('themes.update.removedBody')}</p>
            <FileList items={removed.map((r) => (
              <li key={`${r.filename}:${r.id}`}>{t(r.kind === 'SECTION' ? 'themes.update.section' : 'themes.update.block', { type: r.type, file: r.filename })}</li>
            ))} />
          </Part>
        )}
        {settings.length > 0 && (
          <Part icon={<AlertTriangle className="text-attention" />} title={t('themes.update.settings')}>
            <p className="text-muted">{t('themes.update.settingsBody', { list: settings.join(', ') })}</p>
          </Part>
        )}
        {!attention && <p className="text-muted">{t('themes.update.allGood')}</p>}
      </div>
    </Modal>
  );
}
