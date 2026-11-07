import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { gql } from '../../api';
import { I18nProvider } from '../../i18n';
import { ResourceSelect } from './ResourceSelect';

vi.mock('../../api', () => ({ gql: vi.fn() }));
beforeEach(() => vi.mocked(gql).mockReset());
const data = { collections: { nodes: [] }, products: { nodes: [{ handle: 'saved', title: 'Saved product' }, { handle: 'new', title: 'New product' }] }, pages: { nodes: [] }, blogs: { nodes: [] } };

function mount(value: string) {
  const change = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<I18nProvider initial="en"><QueryClientProvider client={client}><ResourceSelect kind="product" label="Featured product" info="Choose a product" value={value} onChange={change} /></QueryClientProvider></I18nProvider>);
  return { change, client };
}

it('shows a load failure, preserves the saved choice and reloads options on retry', async () => {
  const user = userEvent.setup();
  vi.mocked(gql).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(data);
  const { change } = mount('saved');
  expect(await screen.findByText('Could not load the available items. Try again.')).toBeInTheDocument();
  const select = screen.getByRole('combobox', { name: 'Featured product' });
  expect(select).toHaveValue('saved');
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Retry Featured product' }));
  await screen.findByRole('option', { name: 'Saved product' });
  await waitFor(() => expect(screen.queryByText('Could not load the available items. Try again.')).not.toBeInTheDocument());
  expect(select).toHaveValue('saved');
  expect(select).toHaveAttribute('aria-invalid', 'false');
  expect(change).not.toHaveBeenCalled();
  expect(gql).toHaveBeenCalledTimes(2);
  await user.selectOptions(select, 'new');
  expect(change).toHaveBeenCalledExactlyOnceWith('new');
});

it('treats a successful empty result as empty rather than failed', async () => {
  vi.mocked(gql).mockResolvedValue({ ...data, products: { nodes: [] } });
  const { client } = mount('');
  await waitFor(() => expect(client.getQueryState(['theme-setting-resources'])?.status).toBe('success'));
  const select = screen.getByRole('combobox', { name: 'Featured product' });
  expect(within(select).getAllByRole('option')).toHaveLength(1);
  expect(select).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Retry Featured product' })).not.toBeInTheDocument();
});
