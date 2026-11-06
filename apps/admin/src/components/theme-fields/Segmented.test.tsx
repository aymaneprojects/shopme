import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Segmented } from './Segmented';

const options = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

function Harness({ initial = 'center' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><Segmented label="Alignment" value={value} options={options} onChange={setValue} /><button>Next field</button></>;
}

describe('theme segmented control', () => {
  it('uses the selected option as its only Tab stop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Center' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus();
  });

  it('selects and focuses adjacent options with arrows, wrapping at either end', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('radio', { name: 'Center' }).focus();
    for (const [key, name] of [['ArrowRight', 'Right'], ['ArrowDown', 'Left'], ['ArrowLeft', 'Right'], ['ArrowUp', 'Center']]) {
      await user.keyboard(`{${key}}`);
      const radio = screen.getByRole('radio', { name });
      expect(radio).toHaveFocus();
      expect(radio).toHaveAttribute('aria-checked', 'true');
      expect(screen.getAllByRole('radio').filter((el) => el.tabIndex === 0)).toEqual([radio]);
    }
  });

  it('moves to the first and last option with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('radio', { name: 'Center' }).focus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Left' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Left' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Right' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Right' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps an unknown value reachable and preserves pointer selection', async () => {
    const user = userEvent.setup();
    render(<Harness initial="missing" />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Left' })).toHaveFocus();
    expect(screen.getAllByRole('radio').filter((el) => el.tabIndex === 0)).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    expect(screen.getByRole('radio', { name: 'Right' })).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores navigation when there are no options', () => {
    const change = vi.fn();
    render(<Segmented label="Empty" value="" options={[]} onChange={change} />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(change).not.toHaveBeenCalled();
  });
});
