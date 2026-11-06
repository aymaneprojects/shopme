import { Dropdown, Modal, Popover, SplitButton } from '@shopme/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const items = [
  { key: 'disabled', label: 'Unavailable', disabled: true, onSelect: vi.fn() },
  { key: 'edit', label: 'Edit', onSelect: vi.fn() },
  { key: 'archive', label: 'Archive', onSelect: vi.fn() },
];

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bounds = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });

describe('floating panel placement', () => {
  it('flips above a low trigger and clamps a dropdown inside the right viewport edge', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 320);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? bounds(0, 0, 200, 140) : bounds(300, 250, 30, 30);
    });
    render(<div style={{ overflow: 'hidden', height: 30 }}><Dropdown trigger="Actions" items={items} /></div>);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('popover', 'manual');
    expect(menu).toHaveStyle({ position: 'fixed', left: '152px', top: '106px', maxWidth: '344px', transformOrigin: 'bottom' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('bounds tall popovers and follows their trigger when a containing panel scrolls', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 300);
    let triggerTop = 100;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? bounds(0, 0, 240, 500) : bounds(-30, triggerTop, 50, 30);
    });
    render(<div data-testid="scroller" style={{ overflow: 'auto' }}><Popover trigger="Filters" label="Filters"><input aria-label="Filter" /></Popover></div>);
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    expect(panel).toHaveStyle({ left: '8px', top: '134px', maxHeight: '158px', overflow: 'auto' });
    triggerTop = 50;
    fireEvent.scroll(screen.getByTestId('scroller'));
    expect(panel).toHaveStyle({ top: '84px', maxHeight: '208px' });
    vi.stubGlobal('innerWidth', 280);
    fireEvent.resize(window);
    expect(panel).toHaveStyle({ maxWidth: '264px' });
    screen.getByRole('textbox', { name: 'Filter' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
  });
});

describe('dropdown keyboard and focus behavior', () => {
  it('opens at the first or last available action with arrow keys and announces its trigger', async () => {
    const user = userEvent.setup();
    render(<Dropdown trigger="Actions" items={items} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
  });

  it('returns focus before invoking a selected action, allowing the action to move focus', async () => {
    const user = userEvent.setup();
    let focusedAtAction: Element | null = null;
    render(<><input aria-label="Destination" /><Dropdown trigger="Actions" items={[{
      key: 'edit', label: 'Edit', onSelect: () => {
        focusedAtAction = document.activeElement;
        screen.getByRole('textbox', { name: 'Destination' }).focus();
      },
    }]} /></>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(focusedAtAction).toBe(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Destination' })).toHaveFocus();
  });

  it('dismisses only the floating menu when Escape is pressed inside a parent panel', async () => {
    const user = userEvent.setup();
    const parentEscape = vi.fn();
    render(<div onKeyDown={(e) => { if (e.key === 'Escape') parentEscape(); }}><Dropdown trigger="Actions" items={items} /></div>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(parentEscape).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(parentEscape).toHaveBeenCalledOnce();
  });

  it('keeps both halves of a split action disabled while loading', async () => {
    const user = userEvent.setup();
    render(<SplitButton onClick={vi.fn()} loading menuLabel="More actions" items={items}>Save</SplitButton>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const menuTrigger = screen.getByRole('button', { name: 'More actions' });
    expect(menuTrigger).toBeDisabled();
    await user.click(menuTrigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('also keeps Escape inside an open popover', async () => {
    const user = userEvent.setup();
    const parentEscape = vi.fn();
    render(<div onKeyDown={parentEscape}><Popover trigger="Filters" label="Filters"><input aria-label="Filter" /></Popover></div>);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    await user.click(trigger);
    screen.getByRole('textbox', { name: 'Filter' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(parentEscape).not.toHaveBeenCalled();
  });
});

describe('modal backdrop hit testing', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });

  it('closes on the backdrop but keeps dialog padding and scrollbar clicks inside', () => {
    const close = vi.fn();
    render(<Modal open title="Edit product" onClose={close}>Details</Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Edit product' });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 500, top: 100, bottom: 500, x: 100, y: 100, width: 400, height: 400, toJSON: () => ({}) });
    fireEvent.click(dialog, { clientX: 110, clientY: 110 });
    fireEvent.click(dialog, { clientX: 499, clientY: 200 });
    fireEvent.click(screen.getByText('Details'), { clientX: 200, clientY: 200 });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 50, clientY: 200 });
    expect(close).toHaveBeenCalledOnce();
  });
});
