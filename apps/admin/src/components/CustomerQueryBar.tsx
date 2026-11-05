import { Button } from '@shopme/ui';
import { Filter, Save, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { CUSTOMER_FIELDS, suggestFields, validateCustomerQuery } from '../lib/customer-query';

/**
 * Query bar above the customer list: type the search syntax (`orders_count:>2 country:FR -tag:vip`), see what is wrong with it, apply it to the
 * list and save it as a segment. Plain filter syntax, the same one the segments use.
 */
export function CustomerQueryBar({ value, onApply, onSave }: { value: string; onApply: (q: string) => void; onSave: (q: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const listId = useId();
  useEffect(() => setText(value), [value]);
  const problems = validateCustomerQuery(text);
  const dirty = text.trim() !== value.trim();
  const suggestions = suggestFields(text);
  const apply = () => { if (!problems.length) onApply(text.trim()); };
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); apply(); }} role="search" aria-label={t('bc.queryBar.label')}>
        <div className="relative min-w-64 flex-1">
          <Filter className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
          <input
            value={text} onChange={(e) => setText(e.target.value)} list={listId} aria-label={t('bc.queryBar.label')} placeholder={t('bc.queryBar.placeholder')} aria-invalid={problems.length > 0}
            className={`field-control w-full pl-8 font-mono text-xs ${problems.length ? 'border-critical' : ''}`}
          />
          <datalist id={listId}>{suggestions.map((s) => <option key={s} value={`${text.replace(/\S*$/, '')}${s}:`} />)}</datalist>
        </div>
        <Button type="submit" disabled={!dirty || problems.length > 0}>{t('bc.queryBar.apply')}</Button>
        {value && <Button type="button" variant="plain" onClick={() => onApply('')}><X className="size-4" />{t('bc.queryBar.clear')}</Button>}
        <Button type="button" disabled={!value.trim() || problems.length > 0 || dirty} onClick={() => onSave(value.trim())}><Save className="size-4" />{t('bc.queryBar.save')}</Button>
      </form>
      {problems.length > 0 && (
        <ul className="text-xs text-critical" role="alert">{problems.map((p) => <li key={p.token}><code>{p.token}</code> {t(`bc.queryBar.problem.${p.message}` as Key)}</li>)}</ul>
      )}
      {problems.length === 0 && !value && <p className="text-xs text-muted">{t('bc.queryBar.hint', { fields: CUSTOMER_FIELDS.slice(0, 5).map((f) => f.key).join(', ') })}</p>}
    </div>
  );
}
