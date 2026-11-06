import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { InlineTags } from './ProductSide';

function Harness({ initial = [] }: { initial?: string[] }) {
  const [tags, setTags] = useState(initial);
  return <InlineTags label="Tags" placeholder="Add tags" value={tags} onChange={setTags} suggestions={[]} removeLabel="Remove" />;
}

describe('product tags', () => {
  it.each(['Enter', 'comma', 'blur'] as const)('preserves single-tag entry with %s', async (commit) => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, ' Summer ');
    if (commit === 'Enter') await user.keyboard('{Enter}');
    else if (commit === 'comma') await user.keyboard(',');
    else await user.tab();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Summer']);
    expect(input).toHaveValue('');
  });

  it('adds each pasted comma-separated tag on Enter, trimming blanks and duplicate values', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.click(input);
    await user.paste(' Summer, sale, summer, , VIP ');
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Summer', 'sale', 'VIP']);
    expect(input).toHaveValue('');
  });

  it('commits comma-separated tags on blur without replacing existing tags', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Sale']} />);
    await user.click(screen.getByRole('combobox', { name: 'Tags' }));
    await user.paste('sale, New, ');
    // The trailing space leaves the draft pending until blur.
    await user.tab();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Sale', 'New']);
  });

  it('adds all values immediately when a paste ends with a comma', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.click(input);
    await user.paste('summer, sale,');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['summer', 'sale']);
    expect(input).toHaveValue('');
  });
});
