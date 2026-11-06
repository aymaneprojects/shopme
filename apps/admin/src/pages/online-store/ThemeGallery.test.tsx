import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@shopme/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { Lang } from '../../i18n';
import { SessionProvider } from '../../session';
import { SetupPage } from '../Auth';
import { CreateStorePage } from '../stores/CreateStore';
import { ThemesPage, addedLabel } from './Themes';
import { ThemeStoreAllPage, ThemeStoreDetailPage, ThemeStoreFreePage, ThemeStorePreviewPage } from './ThemeStore';

// jsdom has no <dialog> modal support.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => { vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

const preview = (h: string, k: string) => `/admin/api/theme-previews/${h}-${k}.webp`;
const bundled = [
  { handle: 'aurora', name: 'Aurora', version: '1.2.0', author: 'ShopMe contributors', description: 'A clean, versatile storefront.', tags: ['General', 'Minimal'], templates: ['index', 'product', 'customers/login'], changelog: [{ version: '1.2.0', date: '2026-11-05', notes: ['Account pages.'] }], previews: { desktop: preview('aurora', 'desktop'), mobile: preview('aurora', 'mobile') } },
  { handle: 'fixture-tea', name: 'Fixture Tea', version: '1.0.0', author: 'ShopMe contributors', description: 'A tiny theme used by the tests.', tags: ['Food', 'Whimsical'], templates: ['index', 'customers/login'], changelog: [{ version: '1.0.0', date: null, notes: ['First release.'] }], previews: { desktop: preview('fixture-tea', 'desktop'), mobile: null } },
];
const libraryThemes = [
  { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Aurora', role: 'MAIN', createdAt: '2026-11-04T05:36:00Z', shopmeBundledTheme: { handle: 'aurora', name: 'Aurora', installedVersion: '1.2.0', bundledVersion: '1.2.0', updateAvailable: false } },
  { id: 'gid://shopify/OnlineStoreTheme/2', name: 'Imported', role: 'UNPUBLISHED', createdAt: '2026-11-05T05:35:00Z', shopmeBundledTheme: null },
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
/** The "Discover themes" card of a theme. */
const discoverCard = async (name: string) => (await screen.findByRole('heading', { name, level: 3 })).closest('li') as HTMLElement;

describe('Online Store > Themes', () => {
  it('shows the live theme, the drafts and the themes to discover (not the ones already in the library)', async () => {
    mockApi();
    wrap('en', <ThemesPage />);
    expect(await screen.findByRole('heading', { name: 'Theme drafts' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Aurora', level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Customize' })).toHaveLength(2); // the live theme and the draft
    // the draft row: name, "Added", Publish with its menu
    const draft = (await screen.findByText('Imported')).closest('li') as HTMLElement;
    expect(within(draft).getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'More publish options' })).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    // discover: Fixture Tea only (Aurora is in the library), then the "explore" tile
    const tea = await discoverCard('Fixture Tea');
    expect(within(tea).getByText('by ShopMe contributors')).toBeInTheDocument();
    expect(within(tea).getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(tea.querySelector('img')).toHaveAttribute('src', '/admin/api/theme-previews/fixture-tea-desktop.webp');
    expect(screen.queryByRole('heading', { name: 'Aurora', level: 3 })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Explore more themes', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Visit the theme store' })).toHaveLength(2);
  });

  it('is in French, like the reference screens', async () => {
    const calls = mockApi();
    wrap('fr', <ThemesPage />);
    expect(await screen.findByRole('heading', { name: 'Brouillons de thèmes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Découvrir des thèmes' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Modifier le thème' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Importer' })).toBeInTheDocument();
    expect(within(await discoverCard('Fixture Tea')).getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
    expect(calls.find((c) => c.body?.query?.includes('BundledThemes'))!.body!.variables).toEqual({ locale: 'fr' });
  });

  it('adds a theme to the library from the discover grid', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    wrap('en', <ThemesPage />);
    await user.click(within(await discoverCard('Fixture Tea')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.body?.query?.includes('ThemeInstallBundled'))).toBe(true));
    expect(calls.find((c) => c.body?.query?.includes('ThemeInstallBundled'))!.body!.variables).toEqual({ handle: 'fixture-tea' });
    expect(await screen.findByText('Fixture Tea was added to your theme library')).toBeInTheDocument();
  });

  it('offers the zip import in the Import menu', async () => {
    mockApi();
    const user = userEvent.setup();
    wrap('en', <ThemesPage />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('menuitem', { name: 'Upload a zip file' })).toBeInTheDocument();
  });

  it('writes when a theme was added: the weekday for a recent one, the date otherwise', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(addedLabel('2026-11-04T05:36:00Z', 'en', now)).toMatch(/Wednesday/);
    expect(addedLabel('2026-05-04T05:36:00Z', 'fr', now)).toBe('4 mai 2026');
    expect(addedLabel(undefined, 'en', now)).toBe('');
  });
});

describe('theme store', () => {
  const store = (path: string, ui: React.ReactNode, lang: Lang = 'en') => render(
    <I18nProvider initial={lang}><ToastProvider><QueryClientProvider client={client()}><SessionProvider><MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/online-store/themes/store" element={ui} /><Route path="/online-store/themes/store/free" element={ui} />
      <Route path="/online-store/themes/store/:handle" element={ui} /><Route path="/online-store/themes/store/:handle/preview" element={ui} />
    </Routes></MemoryRouter></SessionProvider></QueryClientProvider></ToastProvider></I18nProvider>,
  );

  it('lists the free themes with their count, filters by industry and sorts by name', async () => {
    mockApi();
    const user = userEvent.setup();
    store('/online-store/themes/store/free', <ThemeStoreFreePage />);
    expect(await screen.findByRole('heading', { name: 'Browse free themes' })).toBeInTheDocument();
    expect(await screen.findByText('2 themes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove the filter Free' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Food' }));
    expect(screen.getByText('1 theme')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fixture Tea', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aurora', level: 2 })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Food' }));
    await user.selectOptions(screen.getByLabelText('Sort'), 'name');
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(['Aurora', 'Fixture Tea']);
  });

  it('browse is in French and has no "free" filter on the all-themes page', async () => {
    mockApi();
    store('/online-store/themes/store', <ThemeStoreAllPage />, 'fr');
    expect(await screen.findByRole('heading', { name: 'Parcourir tous les thèmes' })).toBeInTheDocument();
    expect(screen.queryByText('Filtré par :')).toBeNull();
    expect(await screen.findByRole('checkbox', { name: 'Alimentation' })).toBeInTheDocument();
  });

  it('shows the details of a theme: description, included pages, changelog; adds it from there', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    store('/online-store/themes/store/fixture-tea', <ThemeStoreDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Fixture Tea', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('A tiny theme used by the tests.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View demo' })).toHaveAttribute('href', '/online-store/themes/store/fixture-tea/preview');
    expect(screen.getByRole('heading', { name: 'Version 1.0.0' })).toBeInTheDocument();
    expect(screen.getByText('First release.')).toBeInTheDocument();
    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to theme library' }));
    await waitFor(() => expect(calls.some((c) => c.body?.query?.includes('ThemeInstallBundled'))).toBe(true));
  });

  it('previews a theme on desktop and mobile', async () => {
    mockApi();
    const user = userEvent.setup();
    const { container } = store('/online-store/themes/store/aurora/preview', <ThemeStorePreviewPage />);
    expect(await screen.findByRole('region', { name: 'Aurora' })).toBeInTheDocument();
    expect(container.querySelector('main img')).toHaveAttribute('src', '/admin/api/theme-previews/aurora-desktop.webp');
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(container.querySelector('main img')).toHaveAttribute('src', '/admin/api/theme-previews/aurora-mobile.webp');
    expect(screen.getByText('In your library')).toBeInTheDocument();
  });

  it('says so when the theme does not exist', async () => {
    mockApi();
    store('/online-store/themes/store/nope', <ThemeStoreDetailPage />);
    expect(await screen.findByText('This theme is not available.')).toBeInTheDocument();
  });
});

describe('starting theme choice', () => {
  it('first-store wizard: Aurora is selected, the picked theme is sent with the setup', async () => {
    const calls = mockApi((url) => (url.endsWith('/setup/status') ? { needsSetup: true } : url.endsWith('/api/setup') ? { user: { id: 1 }, shop: { id: 1 } } : undefined));
    const user = userEvent.setup();
    wrap('en', <SetupPage />);
    await user.type(await screen.findByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough pw');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const group = await screen.findByRole('group', { name: 'Starting theme' });
    const aurora = within(group).getByRole('radio', { name: /Aurora/ });
    const tea = within(group).getByRole('radio', { name: /Fixture Tea/ });
    expect(aurora).toBeChecked();
    expect(tea).not.toBeChecked();
    await user.click(tea);
    expect(tea).toBeChecked();
    await user.type(screen.getByLabelText(/Store name/), 'My shop');
    await user.click(screen.getByRole('button', { name: /Create store/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/setup') && c.body)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/api/setup'))!.body).toMatchObject({ shopName: 'My shop', theme: 'fixture-tea' });
  });

  it('first-store wizard: previews a theme and picks it from the preview; French labels', async () => {
    mockApi((url) => (url.endsWith('/setup/status') ? { needsSetup: true } : undefined));
    const user = userEvent.setup();
    wrap('fr', <SetupPage />);
    await user.type(await screen.findByLabelText('E-mail'), 'me@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'long enough pw');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
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
    await user.type(await screen.findByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'long enough pw');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText(/Store name/);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/bundled-themes'))).toBe(true));
    expect(screen.queryByRole('group', { name: 'Starting theme' })).toBeNull();
    await user.type(screen.getByLabelText(/Store name/), 'My shop');
    await user.click(screen.getByRole('button', { name: /Create store/i }));
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
