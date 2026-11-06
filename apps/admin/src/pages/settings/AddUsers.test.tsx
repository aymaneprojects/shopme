import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@shopme/ui';

const mutateMock = vi.fn();
vi.mock('../../api', async (orig) => ({
  ...(await orig<typeof import('../../api')>()),
  gql: async () => ({ shopmeStaffRoles: [{ id: '7', name: 'Support', description: 'Answers customers', permissions: ['orders', 'customers'], members: 1 }] }),
  mutate: (...a: unknown[]) => mutateMock(...a),
}));

import { I18nProvider } from '../../i18n';
import { AddUsersPage } from './AddUsers';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});
beforeEach(() => { mutateMock.mockReset(); mutateMock.mockResolvedValue({}); try { localStorage.setItem('shopme.lang', 'en'); } catch { /* ignore */ } });

const page = () => render(
  <I18nProvider><QueryClientProvider client={new QueryClient()}><ToastProvider><MemoryRouter initialEntries={['/settings/users/new']}><AddUsersPage /></MemoryRouter></ToastProvider></QueryClientProvider></I18nProvider>,
);

describe('Add users page', () => {
  it('has no plan banner and no POS user type, only the three sections', () => {
    page();
    expect(screen.getByRole('heading', { name: 'Add users' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'User information' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Secure sign-in method' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.queryByText(/POS|plan|upgrade|limit/i)).toBeNull();
  });

  it('turns pasted addresses into chips, rejects bad ones, and invites each with the secure sign-in requirement and the chosen role', async () => {
    const user = userEvent.setup();
    page();
    const box = screen.getByLabelText('Emails');
    await user.click(box);
    await user.paste('ada@example.com, grace@example.com\nnot-an-email');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
    expect(await screen.findByText('not-an-email is not a valid address')).toBeInTheDocument();
    await user.clear(box);
    await user.click(screen.getByRole('switch', { name: 'Secure sign-in method' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await user.click(await screen.findByRole('radio', { name: /Support/ }));
    await user.click(screen.getAllByRole('button', { name: 'Assign' }).at(-1)!);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(2));
    expect(mutateMock.mock.calls.map((c) => c[1])).toEqual([
      { email: 'ada@example.com', role: 'staff', roleId: '7', permissions: ['orders', 'customers'], secure: true },
      { email: 'grace@example.com', role: 'staff', roleId: '7', permissions: ['orders', 'customers'], secure: true },
    ]);
  });

  it('removes a chip', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByLabelText('Emails'));
    await user.paste('ada@example.com ');
    await user.click(screen.getByRole('button', { name: 'Remove ada@example.com' }));
    expect(screen.queryByText('ada@example.com')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });
});
