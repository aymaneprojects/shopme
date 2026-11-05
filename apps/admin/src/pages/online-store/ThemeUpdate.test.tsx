import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@shopme/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { Lang } from '../../i18n';
import { ThemesPage } from './Themes';

// jsdom has no <dialog> modal support.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => vi.unstubAllGlobals());

const status = (installed: string, available: boolean) => ({ name: 'Aurora', installedVersion: installed, bundledVersion: '1.2.0', updateAvailable: available });
const themes = [
  { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Aurora', role: 'MAIN', shopmeBundledTheme: status('1.1.0', true) },
  { id: 'gid://shopify/OnlineStoreTheme/2', name: 'Imported', role: 'UNPUBLISHED', shopmeBundledTheme: null },
];
const result = {
  theme: { id: 'gid://shopify/OnlineStoreTheme/3', name: 'Aurora 1.2.0', role: 'UNPUBLISHED' }, previousVersion: '1.1.0', version: '1.2.0',
  carriedOverFiles: ['config/settings_data.json', 'templates/index.json'], removedSettings: ['legacy_toggle'],
  skippedFiles: [{ filename: 'snippets/product-card.liquid', reason: 'EDITED' }],
  removedReferences: [{ filename: 'templates/index.json', kind: 'SECTION', id: 'legacy', type: 'legacy-banner' }],
  userErrors: [],
};

function mockApi() {
  const calls: { query: string; variables?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables?: Record<string, unknown> };
    calls.push(body);
    let data: unknown = { themes: { nodes: themes } };
    if (body.query.includes('ThemeReleaseNotes')) {
      const fr = body.variables?.locale === 'fr';
      data = { theme: { id: themes[0]!.id, shopmeBundledTheme: { ...status('1.1.0', true), releaseNotes: [{ version: '1.2.0', date: '2026-11-05', notes: [fr ? 'Les images respectent le point focal.' : 'Images follow the focal point.'] }] } } };
    }
    if (body.query.includes('ThemeUpdateToBundled')) data = { shopmeThemeUpdateToBundled: result };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

/** The open dialog whose heading is `title` (the dialog element itself has no accessible name). */
const dialogTitled = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('dialog') as HTMLElement;

const page = (lang: Lang) => render(
  <I18nProvider initial={lang}><ToastProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ThemesPage /></MemoryRouter>
  </QueryClientProvider></ToastProvider></I18nProvider>,
);

describe('theme updates on the Themes page', () => {
  it('shows the update on the theme installed from an older Aurora, then what was carried over', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    page('en');
    expect(await screen.findByText('Update available: 1.2.0')).toBeInTheDocument();
    expect(screen.getByText('Version 1.1.0')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Update theme' })).toHaveLength(1); // not on the uploaded theme

    await user.click(screen.getByRole('button', { name: 'Update theme' }));
    const dialog = await dialogTitled('Update to Aurora 1.2.0');
    expect(await within(dialog).findByText('Images follow the focal point.')).toBeInTheDocument();
    expect(within(dialog).getByText(/creates a new unpublished theme, “Aurora 1.2.0”/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Update theme' }));

    const done = await dialogTitled('Aurora 1.2.0 is ready');
    expect(calls.find((c) => c.query.includes('ThemeUpdateToBundled'))!.variables).toEqual({ id: themes[0]!.id });
    expect(within(done).getByText('2 customized files carried over')).toBeInTheDocument();
    expect(within(done).getByText('snippets/product-card.liquid')).toBeInTheDocument();
    expect(within(done).getByText('Replaced by the new version')).toBeInTheDocument();
    expect(within(done).getByText('Section “legacy-banner” in templates/index.json')).toBeInTheDocument();
    expect(within(done).getByText(/legacy_toggle/)).toBeInTheDocument();
    expect(within(done).getByRole('button', { name: 'Customize the new theme' })).toBeInTheDocument();
  });

  it('speaks French', async () => {
    mockApi();
    const user = userEvent.setup();
    page('fr');
    expect(await screen.findByText('Mise à jour disponible : 1.2.0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mettre à jour le thème' }));
    const dialog = await dialogTitled('Mettre à jour vers Aurora 1.2.0');
    expect(await within(dialog).findByText('Les images respectent le point focal.')).toBeInTheDocument();
    expect(within(dialog).getByText('Nouveautés')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mettre à jour le thème' }));
    const done = await dialogTitled('Aurora 1.2.0 est prêt');
    expect(within(done).getByText('2 fichiers personnalisés repris')).toBeInTheDocument();
    expect(within(done).getByText('Modifications de code à refaire')).toBeInTheDocument();
    expect(within(done).getByText('Section « legacy-banner » dans templates/index.json')).toBeInTheDocument();
  });
});
