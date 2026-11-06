import { Dropdown, IndexTable, Modal } from '@shopme/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const rows = [{ id: 'product-1', title: 'Canvas bag' }];
const columns = [{ key: 'title', header: 'Product', cell: (row: typeof rows[number]) => row.title }];

describe('admin table interactions', () => {
  it('opens a focused row with Enter or Space, while keeping static rows out of the tab order', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const { rerender } = render(<IndexTable rows={rows} rowId={(r) => r.id} columns={columns} onRowClick={open} />);
    await user.tab();
    expect(screen.getByRole('row', { name: 'Canvas bag' })).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(rows[0]);
    rerender(<IndexTable rows={rows} rowId={(r) => r.id} columns={columns} />);
    expect(screen.getByRole('row', { name: 'Canvas bag' })).not.toHaveAttribute('tabindex');
  });

  it('lets cell controls act without opening the row, including keyboard use and menu selections', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const action = vi.fn();
    render(<IndexTable rows={rows} rowId={(r) => r.id} onRowClick={open} columns={[
      ...columns,
      { key: 'actions', header: 'Actions', cell: () => <>
        <button type="button" onClick={action}><span>Edit</span></button>
        <a href="#preview">Preview</a>
        <label><input type="checkbox" />Feature</label>
        <Dropdown trigger="More" items={[{ key: 'archive', label: 'Archive', onSelect: action }]} />
      </> },
    ]} />);
    await user.click(screen.getByText('Edit'));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('link', { name: 'Preview' }));
    await user.click(screen.getByText('Feature'));
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(action).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByText('Canvas bag'));
    expect(open).toHaveBeenCalledExactlyOnceWith(rows[0]);
  });

  it('keeps a disabled bulk menu closed', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<IndexTable rows={rows} rowId={(r) => r.id} columns={columns} selected={['product-1']} onSelectedChange={vi.fn()}
      bulkActions={[{ key: 'status', label: 'Change status', disabled: true, onRun: action,
        menu: [{ key: 'archive', label: 'Archive', onRun: action }] }]} />);
    const trigger = screen.getByRole('button', { name: 'Change status' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps checkbox selection separate from row navigation', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const select = vi.fn();
    render(<IndexTable rows={rows} rowId={(r) => r.id} columns={columns} selected={[]} onSelectedChange={select} onRowClick={open} />);
    const row = screen.getByRole('row', { name: 'product-1 Canvas bag' });
    await user.click(within(row).getByRole('checkbox'));
    expect(select).toHaveBeenCalledExactlyOnceWith(['product-1']);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('modal accessibility', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });

  it('announces its visible title and gives simultaneous dialogs distinct labels', () => {
    render(<><Modal open onClose={vi.fn()} title="Edit product">Form</Modal><Modal open onClose={vi.fn()} title="Choose collection">Collections</Modal></>);
    const edit = screen.getByRole('dialog', { name: 'Edit product' });
    const choose = screen.getByRole('dialog', { name: 'Choose collection' });
    expect(edit.getAttribute('aria-labelledby')).not.toBe(choose.getAttribute('aria-labelledby'));
    fireEvent.click(within(edit).getByText('Form'));
    expect(edit).toHaveAttribute('open');
  });
});
