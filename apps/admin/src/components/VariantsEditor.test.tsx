import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { blankVariant, combinations, generateVariants } from '../lib/variants';
import type { OptionDef, VariantDraft } from '../lib/variants';
import { OptionsEditor, VariantsTable } from './VariantsEditor';

describe('generateVariants', () => {
  it('builds the cartesian product in option order', () => {
    const options: OptionDef[] = [{ name: 'Color', values: ['Red', 'Blue'] }, { name: 'Size', values: ['S', 'M', 'L'] }];
    expect(combinations(options)).toHaveLength(6);
    expect(combinations(options)[1]).toEqual(['Red', 'M']);
  });

  it('keeps existing variants, copies price to new ones and drops removed values', () => {
    const red = blankVariant({ id: 'gid://v/1', optionValues: ['Red'], price: '19.00', sku: 'RED' });
    const blue = blankVariant({ id: 'gid://v/2', optionValues: ['Blue'], price: '25.00' });
    const next = generateVariants([{ name: 'Color', values: ['Red', 'Green'] }], [red, blue]);
    expect(next.map((v) => v.optionValues[0])).toEqual(['Red', 'Green']);
    expect(next[0]).toMatchObject({ id: 'gid://v/1', sku: 'RED', price: '19.00' });
    expect(next[1]!.id).toBeUndefined();
    expect(next[1]).toMatchObject({ price: '19.00', sku: '' });
  });

  it('attaches the existing variant to the first combination when an option is added', () => {
    const base = blankVariant({ id: 'gid://v/1', optionValues: ['Red'] });
    const next = generateVariants([{ name: 'Color', values: ['Red'] }, { name: 'Size', values: ['S', 'M'] }], [base]);
    expect(next.map((v) => [v.id, v.optionValues.join('/')])).toEqual([['gid://v/1', 'Red/S'], [undefined, 'Red/M']]);
  });

  it('does not bring back a combination that was deleted, but creates the ones of a new value', () => {
    const options: OptionDef[] = [{ name: 'Color', values: ['Red', 'Blue'] }, { name: 'Size', values: ['S', 'M'] }];
    const all = generateVariants(options, [blankVariant()]);
    expect(all).toHaveLength(4);
    const withoutBlueM = all.filter((v) => v.optionValues.join('/') !== 'Blue/M');
    expect(generateVariants(options, withoutBlueM)).toHaveLength(3);
    const more = generateVariants([options[0]!, { name: 'Size', values: ['S', 'M', 'L'] }], withoutBlueM);
    expect(more.map((v) => v.optionValues.join('/'))).toEqual(['Red/S', 'Red/M', 'Red/L', 'Blue/S', 'Blue/L']);
  });

  it('collapses to a single default variant without options', () => {
    const next = generateVariants([], [blankVariant({ optionValues: ['Red'], price: '5.00' }), blankVariant({ optionValues: ['Blue'] })]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ optionValues: [], price: '5.00' });
  });
});

function Harness() {
  const [state, setState] = useState<{ options: OptionDef[]; variants: VariantDraft[] }>({ options: [], variants: [blankVariant()] });
  return (
    <>
      <OptionsEditor {...state} onChange={setState} />
      <VariantsTable variants={state.variants} locations={[]} currency="EUR" onChange={(variants) => setState({ ...state, variants })} />
    </>
  );
}

describe('OptionsEditor', () => {
  it('generates one variant per combination as values are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /add options/i }));
    await user.type(screen.getByLabelText('Option name'), 'Color');
    await user.type(screen.getByLabelText('Option values'), 'Red{Enter}Blue{Enter}');
    await user.click(screen.getByRole('button', { name: /add another option/i }));
    const names = screen.getAllByLabelText('Option name');
    await user.type(names[1]!, 'Size');
    await user.type(screen.getAllByLabelText('Option values')[1]!, 'S{Enter}M{Enter}L{Enter}');

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    expect(within(rows[0]!).getByText('Red / S')).toBeInTheDocument();
    expect(within(rows[5]!).getByText('Blue / L')).toBeInTheDocument();
  });

  it('removing an option regenerates the variants', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /add options/i }));
    await user.type(screen.getByLabelText('Option name'), 'Size');
    await user.type(screen.getByLabelText('Option values'), 'S{Enter}M{Enter}');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Remove option' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });
});
