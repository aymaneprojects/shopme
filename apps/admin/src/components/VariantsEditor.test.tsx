import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { blankVariant, combinations, generateVariants } from '../lib/variants';
import type { OptionDef, VariantDraft } from '../lib/variants';
import { VariantsManager } from './VariantsManager';

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
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}><VariantsManager {...state} locations={[]} currency="EUR" onChange={(p) => setState({ ...state, ...p })} /></QueryClientProvider>;
}

const listItems = () => within(screen.getByRole('group', { name: 'Variants' })).getAllByRole('listitem');

describe('VariantsManager options', () => {
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

    const rows = listItems();
    expect(rows).toHaveLength(6);
    expect(within(rows[0]!).getByText('Red / S')).toBeInTheDocument();
    expect(within(rows[5]!).getByText('Blue / L')).toBeInTheDocument();
  });

  it('shows the selected variant in the detail panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /add options/i }));
    await user.type(screen.getByLabelText('Option name'), 'Size');
    await user.type(screen.getByLabelText('Option values'), 'S{Enter}M{Enter}');
    await user.click(within(listItems()[1]!).getByRole('button', { name: 'M' }));
    expect(within(listItems()[1]!).getByRole('button', { name: 'M' })).toHaveAttribute('aria-current', 'true');
    await user.clear(screen.getByLabelText('Price'));
    await user.type(screen.getByLabelText('Price'), '12.50');
    expect(within(listItems()[1]!).getByText(/12/)).toBeInTheDocument();
    expect(within(listItems()[0]!).queryByText(/12\.50|12,50/)).toBeNull();
  });

  it('removing the only option goes back to the single variant sections', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /add options/i }));
    await user.type(screen.getByLabelText('Option name'), 'Size');
    await user.type(screen.getByLabelText('Option values'), 'S{Enter}M{Enter}');
    expect(listItems()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove option' }));
    expect(screen.queryByRole('group', { name: 'Variants' })).toBeNull();
    expect(screen.getByLabelText('Price')).toBeInTheDocument();
  });

  it('reveals optional fields on demand', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText('SKU')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'SKU' }));
    expect(screen.getByLabelText('SKU')).toBeInTheDocument();
  });
});
