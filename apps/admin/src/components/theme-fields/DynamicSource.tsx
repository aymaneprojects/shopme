import { Database, Unplug } from 'lucide-react';
import { useContext, useState } from 'react';
import { useI18n } from '../../i18n';
import { hasSource, insertSource, sourcesFor, withoutSources } from '../../lib/dynamic-sources';
import { EditorMenu } from '../../pages/online-store/EditorMenu';
import { SourcesContext } from './context';

/** Small button beside a text setting: pick data of the page (product title, collection description, ...) to show instead of typed text. */
export function DynamicSourceButton({ value, rich, onChange }: { value: string; rich?: boolean; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const template = useContext(SourcesContext);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (template === null) return null;
  const bound = hasSource(value);
  const items = [
    ...sourcesFor(template).map((s) => ({ key: s.id, label: t(s.label), icon: <Database />, onSelect: () => onChange(insertSource(value, s.token, !!rich)) })),
    ...(bound ? [{ key: 'clear', label: t('bs.src.clear'), icon: <Unplug />, separator: true, onSelect: () => onChange(withoutSources(value)) }] : []),
  ];
  return (
    <>
      <button type="button" aria-label={t('bs.src.connect')} title={bound ? t('bs.src.connected') : t('bs.src.connect')} aria-haspopup="menu" aria-pressed={bound}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.right, y: r.bottom + 2 }); }}
        className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-hover hover:text-fg aria-pressed:bg-primary-subtle aria-pressed:text-accent"><Database className="size-3.5" /></button>
      {at && <EditorMenu at={at} align="right" items={items} label={t('bs.src.connect')} onClose={() => setAt(null)} />}
    </>
  );
}
