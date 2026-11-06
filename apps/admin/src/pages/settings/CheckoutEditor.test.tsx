import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@shopme/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { Lang } from '../../i18n';
import { SessionProvider } from '../../session';
import { CheckoutConfigurationPage, draftOf, payloadOf } from './CheckoutEditor';

afterEach(() => { vi.unstubAllGlobals(); });

const settings = { contactMethod: 'email', accountMode: 'guest', nameMode: 'full', company: 'hidden', address2: 'optional', phone: 'optional', marketing: 'unchecked', orderNotes: false, tipping: { enabled: false, presets: [5, 10, 15] } };
const config = { addressAutocomplete: true, branding: { accentColor: '', backgroundColor: '', logoUrl: '', buttonShape: 'rounded', headerText: '', footerText: '' } };
const configurations = [{ id: 'cfg1', name: 'Main checkout', active: true, settings, config }];

function mockApi() {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.includes('/checkout-preview')) return new Response(`<!doctype html><p>preview ${body.page}</p>`, { status: 200, headers: { 'content-type': 'text/html' } });
    const q: string = body?.query ?? '';
    let data: unknown = {};
    if (q.includes('CheckoutConfigurations')) data = { shopmeCheckoutConfigurations: configurations };
    else if (q.includes('CheckoutConfigurationUpdate')) data = { shopmeCheckoutConfigurationUpdate: { configuration: configurations[0], userErrors: [] } };
    else if (q.includes('themes')) data = { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/7', role: 'MAIN' }] } };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}
const previews = (calls: ReturnType<typeof mockApi>) => calls.filter((c) => c.url.includes('/checkout-preview')).map((c) => c.body);
const updates = (calls: ReturnType<typeof mockApi>) => calls.filter((c) => c.body?.query?.includes('CheckoutConfigurationUpdate')).map((c) => c.body.variables);

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
function setup(lang: Lang = 'en', path = '/settings/checkout/cfg1?page=checkout') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/settings/checkout/:id', element: <><CheckoutConfigurationPage /><Where /></> }, { path: '*', element: null }], { initialEntries: [path] });
  return render(<I18nProvider initial={lang}><ToastProvider><QueryClientProvider client={client}><SessionProvider><RouterProvider router={router} /></SessionProvider></QueryClientProvider></ToastProvider></I18nProvider>);
}

describe('checkout and accounts editor', () => {
  it('shows the checkout blocks in the reference order, with the configuration and its page selector', async () => {
    const calls = mockApi();
    setup();
    expect(await screen.findByText('Main checkout')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Header', 'Main', 'Order summary', 'Footer']);
    for (const label of ['Logo', 'Contact', 'Delivery', 'Payment', 'Action', 'Cart', 'Discounts', 'Total', 'Policies']) expect(screen.getAllByRole('button', { name: label }).length, label).toBeGreaterThan(0);
    await waitFor(() => expect(previews(calls)[0]).toMatchObject({ page: 'checkout', settings: { marketing: 'unchecked' } }));
    expect(await screen.findByTitle('Preview of Checkout')).toBeInTheDocument();
  });

  it('is in French with the reference labels', async () => {
    mockApi();
    setup('fr');
    expect(await screen.findByText('Actif')).toBeInTheDocument();
    for (const label of ['En-tête', 'Principale', 'Résumé de la commande', 'Pied de page']) expect(screen.getByRole('region', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coordonnées' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer maintenant' })).toBeInTheDocument();
  });

  it('edits a block, refreshes the preview with the unsaved value, undoes, then saves', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Contact' }));
    const select = await screen.findByLabelText('Email marketing checkbox');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.selectOptions(select, 'checked');
    expect(save).toBeEnabled();
    await waitFor(() => expect(previews(calls).at(-1)).toMatchObject({ settings: { marketing: 'checked' } }), { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Email marketing checkbox'), 'hidden');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updates(calls)).toHaveLength(1));
    expect(updates(calls)[0]).toMatchObject({ id: 'cfg1', settings: { marketing: 'hidden', tipping: { enabled: false, presets: [5, 10, 15] } }, config });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });

  it('puts the look settings in the settings tab, and the tip presets in the Total block', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Total' }));
    await user.click(await screen.findByRole('switch', { name: /tip/i }));
    const presets = await screen.findByLabelText('Tip presets (%)');
    await user.clear(presets);
    await user.type(presets, '8, 12');
    await waitFor(() => expect(previews(calls).at(-1)).toMatchObject({ settings: { tipping: { enabled: true, presets: [8, 12] } } }), { timeout: 3000 });
    await user.click(screen.getByRole('tab', { name: 'Theme settings' }));
    expect(screen.getAllByLabelText('Accent color')).toHaveLength(2); // the hex field and the colour picker
  });

  it('switches page from the selector: the thank-you page has its own blocks and preview', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    setup();
    await screen.findByText('Main checkout');
    await user.click(screen.getByRole('button', { name: 'Page' }));
    const menu = screen.getByRole('menu', { name: 'Page' });
    expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Checkout', 'Post-purchase', 'Customer accounts']);
    expect(within(menu).getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['Checkout', 'Thank you', 'Sign in', 'Orders', 'Order status', 'Profile']);
    expect(within(menu).getByRole('menuitem', { name: 'Online store theme' })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Thank you' }));
    expect(screen.getByTestId('where')).toHaveTextContent('page=thank-you');
    expect(await screen.findByRole('button', { name: 'Order details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delivery' })).toBeNull();
    await waitFor(() => expect(previews(calls).some((p) => p.page === 'thank-you')).toBe(true));
  });

  it('says so when the configuration does not exist', async () => {
    mockApi();
    setup('en', '/settings/checkout/nope');
    expect(await screen.findByText('This checkout configuration does not exist.')).toBeInTheDocument();
  });
});

describe('draft values', () => {
  it('sends the tip presets as typed once they are whole numbers, and keeps the last good ones otherwise', () => {
    const d = draftOf({ settings: settings as never, config: config as never });
    expect(d.presets).toBe('5, 10, 15');
    expect(payloadOf({ ...d, presets: '20 25,30' }).settings.tipping.presets).toEqual([20, 25, 30]);
    expect(payloadOf({ ...d, presets: '12, x' }).settings.tipping.presets).toEqual([5, 10, 15]);
  });
});
