import { Button } from '@shopme/ui';
import { Plus, X } from 'lucide-react';
import { useT } from '../i18n';
import { RULE_COLUMNS, changeColumn, defaultRule, isNumericColumn, needsValue, relationsFor } from '../lib/collection-rules';
import type { Rule, RuleColumn, RuleRelation, RuleSet } from '../lib/collection-rules';

const sel = 'field-control';

/** "Products must match all/any conditions" with a list of column / relation / value rows. */
export function ConditionsBuilder({ value, onChange }: { value: RuleSet; onChange: (v: RuleSet) => void }) {
  const t = useT();
  const setRule = (i: number, r: Rule) => onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? r : x)) });
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex items-center gap-4 text-[13px]">
        <legend className="mb-1 font-medium">{t('conditions.mustMatch')}</legend>
        {[false, true].map((disj) => (
          <label key={String(disj)} className="inline-flex items-center gap-1.5">
            <input type="radio" name="match" className="accent-(--color-primary)" checked={value.appliedDisjunctively === disj} onChange={() => onChange({ ...value, appliedDisjunctively: disj })} />
            {t(disj ? 'conditions.any' : 'conditions.all')}
          </label>
        ))}
      </fieldset>
      {value.rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2" role="group" aria-label={t('conditions.rule', { n: i + 1 })}>
          <select aria-label={t('conditions.field')} className={sel} value={r.column} onChange={(e) => setRule(i, changeColumn(r, e.target.value as RuleColumn))}>
            {RULE_COLUMNS.map((c) => <option key={c} value={c}>{t(`column.${c}` as 'column.TAG')}</option>)}
          </select>
          <select aria-label={t('conditions.relation')} className={sel} value={r.relation} onChange={(e) => setRule(i, { ...r, relation: e.target.value as RuleRelation })}>
            {relationsFor(r.column).map((rel) => <option key={rel} value={rel}>{t(`relation.${rel}` as 'relation.EQUALS')}</option>)}
          </select>
          {needsValue(r.relation) && (r.column === 'IS_PRICE_REDUCED' ? (
            <select aria-label={t('conditions.value')} className={sel} value={r.condition} onChange={(e) => setRule(i, { ...r, condition: e.target.value })}>
              <option value="true">{t('conditions.true')}</option>
              <option value="false">{t('conditions.false')}</option>
            </select>
          ) : (
            <input aria-label={t('conditions.value')} className={`${sel} min-w-40 flex-1`} inputMode={isNumericColumn(r.column) ? 'decimal' : undefined} value={r.condition} onChange={(e) => setRule(i, { ...r, condition: e.target.value })} />
          ))}
          <button type="button" aria-label={t('conditions.remove')} className="rounded p-1.5 text-muted hover:bg-surface" onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}><X className="size-4" /></button>
        </div>
      ))}
      <div><Button size="sm" onClick={() => onChange({ ...value, rules: [...value.rules, defaultRule()] })}><Plus className="size-4" />{t('conditions.add')}</Button></div>
    </div>
  );
}
