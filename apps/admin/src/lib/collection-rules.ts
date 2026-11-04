// Smart collection rules (docs/spec/admin-api-mvp.md section 3.1; operator matrix from admin-ux.md section 6.1).

export const RULE_COLUMNS = ['TAG', 'TITLE', 'TYPE', 'VENDOR', 'VARIANT_PRICE', 'VARIANT_COMPARE_AT_PRICE', 'VARIANT_WEIGHT', 'VARIANT_INVENTORY', 'VARIANT_TITLE', 'IS_PRICE_REDUCED'] as const;
export type RuleColumn = (typeof RULE_COLUMNS)[number];
export type RuleRelation = 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'STARTS_WITH' | 'ENDS_WITH' | 'CONTAINS' | 'NOT_CONTAINS' | 'IS_SET' | 'IS_NOT_SET';

const TEXT: RuleRelation[] = ['EQUALS', 'NOT_EQUALS', 'STARTS_WITH', 'ENDS_WITH', 'CONTAINS', 'NOT_CONTAINS'];
const NUMERIC: RuleRelation[] = ['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN'];

const MATRIX: Record<RuleColumn, RuleRelation[]> = {
  TAG: ['EQUALS', 'NOT_EQUALS'],
  TITLE: TEXT,
  TYPE: TEXT,
  VENDOR: TEXT,
  VARIANT_TITLE: TEXT,
  VARIANT_PRICE: NUMERIC,
  VARIANT_WEIGHT: NUMERIC,
  VARIANT_INVENTORY: NUMERIC,
  VARIANT_COMPARE_AT_PRICE: [...NUMERIC, 'IS_SET', 'IS_NOT_SET'],
  IS_PRICE_REDUCED: ['EQUALS'],
};

export const relationsFor = (column: RuleColumn): RuleRelation[] => MATRIX[column];
export const isNumericColumn = (c: RuleColumn) => c === 'VARIANT_PRICE' || c === 'VARIANT_WEIGHT' || c === 'VARIANT_INVENTORY' || c === 'VARIANT_COMPARE_AT_PRICE';
export const needsValue = (r: RuleRelation) => r !== 'IS_SET' && r !== 'IS_NOT_SET';

export interface Rule { column: RuleColumn; relation: RuleRelation; condition: string }
export interface RuleSet { appliedDisjunctively: boolean; rules: Rule[] }

export const defaultRule = (column: RuleColumn = 'TAG'): Rule => ({
  column, relation: relationsFor(column)[0]!, condition: column === 'IS_PRICE_REDUCED' ? 'true' : '',
});

/** Switching column keeps the relation when still valid, else resets it. */
export function changeColumn(rule: Rule, column: RuleColumn): Rule {
  const relation = relationsFor(column).includes(rule.relation) ? rule.relation : relationsFor(column)[0]!;
  return { column, relation, condition: column === 'IS_PRICE_REDUCED' ? 'true' : isNumericColumn(column) === isNumericColumn(rule.column) ? rule.condition : '' };
}

export function isRuleValid(rule: Rule): boolean {
  if (!relationsFor(rule.column).includes(rule.relation)) return false;
  if (!needsValue(rule.relation)) return true;
  if (isNumericColumn(rule.column)) return rule.condition.trim() !== '' && !Number.isNaN(Number(rule.condition.replace(',', '.')));
  return rule.condition.trim() !== '';
}

export const toRuleInput = (rules: Rule[]) => rules.map((r) => ({ column: r.column, relation: r.relation, condition: isNumericColumn(r.column) ? r.condition.trim().replace(',', '.') : r.condition.trim() }));
