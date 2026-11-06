import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@shopme/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.useRealTimers());

describe('Tooltip', () => {
  it('shows the label and the shortcut keycaps after the delay, and describes the button', () => {
    vi.useFakeTimers();
    render(<Tooltip side="right" delay={300} content="Expand navigation" shortcut={['Ctrl', 'B']}><button type="button" aria-label="Expand navigation">x</button></Tooltip>);
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(310); });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Expand navigation');
    expect([...tip.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'B']);
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.mouseLeave(btn.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(btn.getAttribute('aria-describedby')).toBeNull();
  });

  it('opens at once on keyboard focus and closes with Escape', () => {
    vi.useFakeTimers();
    render(<Tooltip content="Search"><button type="button">s</button></Tooltip>);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip').textContent).toBe('Search');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
