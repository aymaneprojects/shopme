import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { changeColumn, defaultRule, isRuleValid, relationsFor, toRuleInput } from '../lib/collection-rules';
import type { RuleSet } from '../lib/collection-rules';
import { ConditionsBuilder } from './ConditionsBuilder';

describe('collection rules', () => {
  it('restricts relations per column', () => {
    expect(relationsFor('VARIANT_PRICE')).toEqual(['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN']);
    expect(relationsFor('TITLE')).toContain('CONTAINS');
    expect(relationsFor('TAG')).not.toContain('CONTAINS');
  });

  it('resets an invalid relation when the column changes and validates values', () => {
    const rule = { column: 'TITLE' as const, relation: 'CONTAINS' as const, condition: 'shirt' };
    const next = changeColumn(rule, 'VARIANT_PRICE');
    expect(next.relation).toBe('EQUALS');
    expect(next.condition).toBe('');
    expect(isRuleValid(next)).toBe(false);
    expect(isRuleValid({ ...next, condition: '12,5' })).toBe(true);
    expect(toRuleInput([{ ...next, condition: '12,5' }])[0]!.condition).toBe('12.5');
  });
});

function Harness({ onChange }: { onChange: (v: RuleSet) => void }) {
  const [v, setV] = useState<RuleSet>({ appliedDisjunctively: false, rules: [defaultRule()] });
  return <ConditionsBuilder value={v} onChange={(n) => { setV(n); onChange(n); }} />;
}

describe('ConditionsBuilder', () => {
  it('edits the match mode, rules and operators', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByLabelText('any condition'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ appliedDisjunctively: true }));

    await user.selectOptions(screen.getByLabelText('Field'), 'VARIANT_PRICE');
    expect(screen.queryByRole('option', { name: 'contains' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Operator'), 'LESS_THAN');
    await user.type(screen.getByLabelText('Value'), '50');
    expect(onChange).toHaveBeenLastCalledWith({ appliedDisjunctively: true, rules: [{ column: 'VARIANT_PRICE', relation: 'LESS_THAN', condition: '50' }] });

    await user.click(screen.getByRole('button', { name: 'Add another condition' }));
    expect(screen.getAllByLabelText('Field')).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Remove condition' })[0]!);
    expect(screen.getAllByLabelText('Field')).toHaveLength(1);
  });

  it('hides the value input for "is set"', async () => {
    const user = userEvent.setup();
    render(<Harness onChange={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Field'), 'VARIANT_COMPARE_AT_PRICE');
    await user.selectOptions(screen.getByLabelText('Operator'), 'IS_SET');
    expect(screen.queryByLabelText('Value')).not.toBeInTheDocument();
  });
});
