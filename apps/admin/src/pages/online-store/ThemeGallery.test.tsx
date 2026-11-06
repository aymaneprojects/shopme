import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@shopme/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { Lang } from '../../i18n';
import { SessionProvider } from '../../session';
import { SetupPage } from '../Auth';
import { CreateStorePage } from '../stores/CreateStore';
import { ThemesPage } from './Themes';

// jsdom has no <dialog> modal support.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => { vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

const preview = (h: string, k: string) => `/admin/api/theme-previews/${h}-${k}.webp`;
const bundled = [
  { handle: 'aurora', name: 'Aurora', version: '1.2.0', author: 'ShopMe contributors', description: 'A clean, versatile storefront.', tags: ['General', 'Minimal'], previews: { desktop: preview('aurora', 'desktop'), mobile: preview('aurora', 'mobile') } },
  { handle: 'fixture-tea', name: 'Fixture Tea', version: '1.0.0', author: 'ShopMe contributors', description: 'A tiny theme used by the tests.', tags: ['Food', 'Whimsical'], previews: { desktop: preview('fixture-tea', 'desktop'), mobile: null } },
];
const libraryThemes = [
  { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Aurora', role: 'MAIN', shopmeBundledTheme: { handle: 'aurora', name: 'Aurora', installedVersion: '1.2.0', bundledVersion: '1.2.0', updateAvailable: false } },
  { id: 'gid://shopify/OnlineStoreTheme/2', name: 'Imported', role: 'UNPUBLISHED', shopmeBundledTheme: null },
];

function mockApi(extra: (url: string, body: { query?: string; variables?: Record<string, unknown> } | null) => unknown | undefined = () => undefined) {
  const calls: { url: string; body: { query?: string; variables?: Record<string, unknown> } | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { query?: string; variables?: Record<string, unknown> }) : null;
    calls.push({ url, body });
    const q = body?.query ?? '';
    let data: unknown = extra(url, body);
    if (data === undefined) {
      if (url.includes('/bundled-themes')) data = { themes: bundled };
      else if (q.includes('BundledThemes')) data = { shopmeBundledThemes: bundled };
      else if (q.includes('ThemeInstallBundled')) data = { shopmeThemeInstallBundled: { theme: { id: 'gid://shopify/OnlineStoreTheme/9', name: 'Fixture Tea', role: 'UNPUBLISHED' }, userErrors: [] } };
      else if (q.includes('query Themes')) data = { themes: { nodes: libraryThemes } };
      else data = {};
    }
    const json = url.includes('/graphql') ? { data } : data;
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (lang: Lang, ui: React.ReactNode) => render(
  <I18nProvider initial={lang}><ToastProvider><QueryClientProvider client={client()}><SessionProvider><MemoryRouter>{ui}</MemoryRouter></SessionProvider></QueryClientProvider></ToastProvider></I18nProvider>,
);
const dialogTitled = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('dialog') as HTMLElement;
/** The gallery card of a theme (Aurora also has a card in the theme library above). */
const card = async (name: string) => {
  const gallery = (await screen.findByRole('heading', { name: /^(Free ShopMe themes|Thèmes ShopMe gratuits)$/ })).closest('section') as HTMLElement;
  return (await within(gallery).findByRole('heading', { name, level: 3 })).closest('li') as HTMLElement;
};

describe('Free ShopMe themes (Online Store > Themes)', () => {
  it('shows a card per bundled theme with description and tags, and "In your library" for the installed ones', async () => {
    mockApi();
    wrap('en', <ThemesPage />);
    expect(await screen.findByRole('heading', { name: 'Free ShopMe themes' })).toBeInTheDocument();
    const auroraCard = await card('Aurora');
    expect(within(auroraCard).getByText('A clean, versatile storefront.')).toBeInTheDocument();
    expect(within(auroraCard).getByText('General')).toBeInTheDocument();
    expect(within(auroraCard).getByText('In your library')).toBeInTheDocument();
    expect(within(auroraCard).queryByRole('button', { name: 'Add to theme library' })).toBeNull();
    expect(within(auroraCard).getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(auroraCard.querySelector('img')).toHaveAttribute('src', '/admin/api/theme-previews/aurora-desktop.webp');

    const tea = await card('Fixture Tea');
    expect(within(tea).getByText('Food')).toBeInTheDocument();
    expect(within(tea).getByText('Whimsical')).toBeInTheDocument(); // an unknown tag is shown as the theme wrote it
    expect(within(tea).queryByText('In your library')).toBeNull();
    expect(within(tea).getByRole('button', { name: 'Add to theme library' })).toBeInTheDocument();
  });

  it('is in French, with the tags translated', async () => {
    const calls = mockApi();
    wrap('fr', <ThemesPage />);
    expect(await screen.findByRole('heading', { name: 'Thèmes ShopMe gratuits' })).toBeInTheDocument();
    const tea = await card('Fixture Tea');
    expect(within(tea).getByText('Alimentation')).toBeInTheDocument();
    expect(within(tea).getByRole('button', { name: 'Ajouter à la bibliothèque de thèmes' })).toBeInTheDocument();
    expect(within(tea).getByRole('button', { name: 'Aperçu' })).toBeInTheDocument();
    expect(within(await card('Aurora')).getByText('Dans votre bibliothèque')).toBeInTheDocument();
    expect(calls.find((c) => c.body?.query?.includes('BundledThemes'))!.body!.variables).toEqual({ locale: 'fr' });
  });

  it('adds a theme to the library', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    wrap('en', <ThemesPage />);
    await user.click(within(await card('Fixture Tea')).getByRole('button', { name: 'Add to theme library' }));
    await waitFor(() => expect(calls.some((c) => c.body?.query?.includes('ThemeInstallBundled'))).toBe(true));
    expect(calls.find((c) => c.body?.query?.includes('ThemeInstallBundled'))!.body!.variables).toEqual({ handle: 'fixture-tea' });
    expect(await screen.findByText('Fixture Tea was added to your theme library')).toBeInTheDocument();
  });

  it('opens an enlarged preview with a desktop / mobile toggle', async () => {
    mockApi();
    const user = userEvent.setup();
    wrap('en', <ThemesPage />);
    await user.click(within(await card('Aurora')).getByRole('button', { name: 'Preview' }));
    const dialog = await dialogTitled('Preview: Aurora');
    const desktop = within(dialog).getByRole('button', { name: 'Desktop' });
    const mobile = within(dialog).getByRole('button', { name: 'Mobile' });
    expect(desktop).toHaveAttribute('aria-pressed', 'true');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/admin/api/theme-previews/aurora-desktop.webp');
    await user.click(mobile);
    expect(mobile).toHaveAttribute('aria-pressed', 'true');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/admin/api/theme-previews/aurora-mobile.webp');
    expect(within(dialog).getByText('In your library')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('adds a theme from its preview, and shows a placeholder when it has no image', async () => {
    const calls = mockApi((_u, b) => (b?.query?.includes('BundledThemes') ? { shopmeBundledThemes: [{ ...bundled[1]!, previews: { desktop: null, mobile: null } }] } : undefined));
    const user = userEvent.setup();
    wrap('en', <ThemesPage />);
    const tea = await card('Fixture Tea');
    expect(tea.querySelector('img')).toBeNull();
    expect(within(tea).getByText('No preview yet')).toBeInTheDocument();
    await user.click(within(tea).getByRole('button', { name: 'Preview' }));
    const dialog = await dialogTitled('Preview: Fixture Tea');
    await user.click(within(dialog).getByRole('button', { name: 'Add to theme library' }));
    await waitFor(() => expect(calls.some((c) => c.body?.query?.includes('ThemeInstallBundled'))).toBe(true));
  });
});

describe('starting theme choice', () => {
  it('first-store wizard: Aurora is selected, the picked theme is sent with the setup', async () => {
    const calls = mockApi((url) => (url.endsWith('/setup/status') ? { needsSetup: true } : url.endsWith('/api/setup') ? { user: { id: 1 }, shop: { id: 1 } } : undefined));
    const user = userEvent.setup();
    wrap('en', <SetupPage />);
    const group = await screen.findByRole('group', { name: 'Starting theme' });
    const aurora = within(group).getByRole('radio', { name: /Aurora/ });
    const tea = within(group).getByRole('radio', { name: /Fixture Tea/ });
    expect(aurora).toBeChecked();
    expect(tea).not.toBeChecked();
    await user.click(tea);
    expect(tea).toBeChecked();
    await user.type(screen.getByLabelText(/Store name/), 'My shop');
    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough pw');
    await user.click(screen.getByRole('button', { name: /Create|Set up|Start/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/setup') && c.body)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/api/setup'))!.body).toMatchObject({ shopName: 'My shop', theme: 'fixture-tea' });
  });

  it('first-store wizard: previews a theme and picks it from the preview; French labels', async () => {
    mockApi((url) => (url.endsWith('/setup/status') ? { needsSetup: true } : undefined));
    const user = userEvent.setup();
    wrap('fr', <SetupPage />);
    const group = await screen.findByRole('group', { name: 'Thème de départ' });
    const teaCard = within(group).getByRole('radio', { name: /Fixture Tea/ }).closest('li') as HTMLElement;
    await user.click(within(teaCard).getByRole('button', { name: 'Aperçu' }));
    const dialog = await dialogTitled('Aperçu : Fixture Tea');
    await user.click(within(dialog).getByRole('button', { name: 'Mobile' }));
    await user.click(within(dialog).getByRole('button', { name: 'Utiliser ce thème' }));
    expect(within(group).getByRole('radio', { name: /Fixture Tea/ })).toBeChecked();
  });

  it('first-store wizard: no picker, and no theme sent, when Aurora is the only theme', async () => {
    const calls = mockApi((url) => (url.endsWith('/setup/status') ? { needsSetup: true } : url.includes('/bundled-themes') ? { themes: [bundled[0]] } : url.endsWith('/api/setup') ? { user: { id: 1 }, shop: { id: 1 } } : undefined));
    const user = userEvent.setup();
    wrap('en', <SetupPage />);
    await screen.findByLabelText(/Store name/);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/bundled-themes'))).toBe(true));
    expect(screen.queryByRole('group', { name: 'Starting theme' })).toBeNull();
    await user.type(screen.getByLabelText(/Store name/), 'My shop');
    await user.type(screen.getByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough pw');
    await user.click(screen.getByRole('button', { name: /Create|Set up|Start/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/setup') && c.body)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/api/setup'))!.body).not.toHaveProperty('theme');
  });

  it('Create a store: sends the picked theme', async () => {
    window.history.pushState({}, '', '/admin/stores/new');
    const me = { multiStore: true, account: { id: 1, email: 'a@b.c', firstName: null, lastName: null, platformOwner: true }, canCreateStores: true, stores: [], user: null, shop: null };
    const calls = mockApi((url) => (url.endsWith('/setup/status') ? { needsSetup: false } : url.endsWith('/auth/me') ? me : url.endsWith('/account/stores') ? { store: { adminPath: '/admin/store/x/' } } : url.includes('/account/stores/handle') ? { handle: 'tea-shop', available: true, problem: null, host: 'tea-shop.example.test' } : undefined));
    const user = userEvent.setup();
    wrap('en', <CreateStorePage />);
    const group = await screen.findByRole('group', { name: 'Starting theme' });
    expect(within(group).getByRole('radio', { name: /Aurora/ })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: /Fixture Tea/ }));
    await user.type(screen.getByLabelText(/Store name/i), 'Tea Shop');
    await user.click(screen.getByRole('button', { name: /Create store|Create/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/account/stores') && c.body)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/account/stores') && c.body)!.body).toMatchObject({ shopName: 'Tea Shop', theme: 'fixture-tea' });
  });
});
