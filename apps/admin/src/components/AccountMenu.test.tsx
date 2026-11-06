import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { AccountMenu } from './AccountMenu';

const shop = { id: 1, name: 'Boutique', email: 'a@b.fr', currency: 'EUR', country: 'FR', locale: 'en', timezone: 'UTC', weightUnit: 'kg' };
const user = { id: 1, shopId: 1, email: 'a@b.fr', firstName: 'A', lastName: 'B', role: 'owner' };
let session: Record<string, unknown>;
let multi: unknown;
vi.mock('../session', () => ({ useSession: () => ({ state: session, logout: async () => {} }), useMulti: () => multi }));
vi.mock('./ActivityBell', () => ({ ActivityBell: () => null }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});
beforeEach(() => { localStorage.clear(); multi = null; session = { status: 'authenticated', user, shop }; });

const openMenu = async (u: ReturnType<typeof userEvent.setup>) => { await u.click(screen.getByRole('button', { name: /account|compte/i })); };

describe('Create a store in single-store mode', () => {
  it('explains how to turn on multiple stores on a server', async () => {
    const u = userEvent.setup();
    render(<I18nProvider><AccountMenu collapsed={false} /></I18nProvider>);
    await openMenu(u);
    await u.click(screen.getByRole('menuitem', { name: 'Create a store' }));
    expect(screen.getByText(/MULTI_STORE=true/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the multi-store guide' })).toHaveAttribute('href', expect.stringContaining('docs/install/multi-store.md'));
  });

  it('says it is available on the server version in the desktop app', async () => {
    session = { status: 'authenticated', user, shop, desktop: true };
    const u = userEvent.setup();
    render(<I18nProvider><AccountMenu collapsed={false} /></I18nProvider>);
    await openMenu(u);
    await u.click(screen.getByRole('menuitem', { name: 'Create a store' }));
    expect(screen.getByText('Several stores are available on the server version of ShopMe.')).toBeInTheDocument();
    expect(screen.queryByText(/MULTI_STORE/)).toBeNull();
  });

  it('opens the create page in multi-store mode instead', async () => {
    multi = { account: { id: 1, email: 'a@b.fr', firstName: null, lastName: null, platformOwner: false }, stores: [], canCreateStores: true, storeHandle: 'boutique', suspended: false };
    const u = userEvent.setup();
    render(<I18nProvider><AccountMenu collapsed={false} /></I18nProvider>);
    await openMenu(u);
    expect(screen.getByRole('menuitem', { name: 'Create a store' })).toHaveAttribute('href', '/admin/stores/new');
  });
});
