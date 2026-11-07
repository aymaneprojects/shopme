import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { Combobox } from './Combobox';

function Harness({ options = ['Coffee', 'Tea', 'Cocoa'] }: { options?: string[] }) {
  const [value, setValue] = useState('');
  return <I18nProvider initial="en"><label htmlFor="vendor">Vendor</label><Combobox id="vendor" value={value} onChange={setValue} options={options} /></I18nProvider>;
}
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
afterEach(() => {
  vi.restoreAllMocks();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

describe('combobox keyboard suggestions', () => {
  it('announces the active suggestion while keeping focus in the input and selects on Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Vendor' });
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const tea = screen.getByRole('option', { name: 'Tea' });
    expect(tea.id).not.toBe('');
    expect(input).toHaveAttribute('aria-activedescendant', tea.id);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('Tea');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('scrolls keyboard-highlighted suggestions into view without moving input focus', async () => {
    const user = userEvent.setup();
    const scrolled: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value() {} });
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) { scrolled.push(this); });
    render(<Harness options={Array.from({ length: 30 }, (_, i) => `Vendor ${i + 1}`)} />);
    const input = screen.getByRole('combobox', { name: 'Vendor' });
    await user.click(input);
    await user.keyboard('{ArrowDown>15/}');
    expect(scrolled.at(-1)).toBe(screen.getByRole('option', { name: 'Vendor 15' }));
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(input).toHaveFocus();
  });

  it('clears the active-option reference when the filter changes or the popup closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Vendor' });
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant');
    await user.type(input, 'Tea');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}{Escape}');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
