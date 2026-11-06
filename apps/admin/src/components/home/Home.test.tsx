import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { detectTasks } from '../../lib/home';
import type { TaskSignals } from '../../lib/home';
import { KpiBar } from './KpiBar';
import { SetupGuide } from './SetupGuide';

vi.mock('../../api', () => ({ gql: vi.fn() }));
import { gql } from '../../api';

const cols = (extra: Array<{ key: string }>) => [{ key: 'period' }, ...extra];
function report(name: string, from: string) {
  const days = [from, from.replace(/\d\d$/, (d) => String(Number(d) + 1).padStart(2, '0'))];
  if (name === 'SALES_OVER_TIME') return { currencyCode: 'EUR', columns: cols([{ key: 'total' }]), rows: days.map((d, i) => [d, 1000 * (i + 1)]), totals: { total: 3000 } };
  if (name === 'ORDERS_OVER_TIME') return { currencyCode: 'EUR', columns: cols([{ key: 'orders' }]), rows: days.map((d, i) => [d, i + 1]), totals: { orders: 3 } };
  return { currencyCode: 'EUR', columns: cols([{ key: 'sessions' }, { key: 'conversion' }]), rows: days.map((d, i) => [d, 10 * (i + 1), 5 * (i + 1)]), totals: { sessions: 30, conversion: 10 } };
}

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider><MemoryRouter>{ui}</MemoryRouter></I18nProvider></QueryClientProvider>);
}

describe('key figures bar', () => {
  beforeEach(() => {
    vi.mocked(gql).mockImplementation((async (_q: string, vars?: { name?: string; from?: string }) => (vars?.name ? { shopmeReport: report(vars.name, vars.from!) } : { shopmeLiveView: { visitorsNow: 4 } })) as never);
  });

  it('shows the four figures and the live visitors, with the chart closed', async () => {
    wrap(<KpiBar currency="EUR" timezone="Europe/Paris" />);
    expect(await screen.findByTestId('kpi-sales')).toHaveTextContent('€30.00');
    expect(screen.getByTestId('kpi-orders')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-sessions')).toHaveTextContent('30');
    expect(screen.getByTestId('kpi-conversion')).toHaveTextContent('10 %');
    expect(await screen.findByRole('link', { name: /Live visitors: 4/ })).toHaveAttribute('href', '/analytics/live');
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('LAST_30_DAYS');
    expect(screen.getByText('All channels')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: / over time/ })).toBeNull();
  });

  it('opens the chart card of a figure, switches figures, and closes with the same figure, the button or Esc', async () => {
    const user = userEvent.setup();
    wrap(<KpiBar currency="EUR" timezone="Europe/Paris" />);
    await screen.findByTestId('kpi-sales');
    const sales = screen.getByRole('button', { name: 'Chart of Total sales' });
    const orders = screen.getByRole('button', { name: 'Chart of Orders' });
    expect(sales).toHaveAttribute('aria-expanded', 'false');

    await user.click(sales);
    const card = await screen.findByRole('region', { name: 'Total sales over time' });
    expect(sales).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByText('Order totals after refunds, with shipping and taxes included.')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Total sales over time' })).toBeInTheDocument();
    // The legend names both periods.
    expect(within(card).getAllByRole('listitem')).toHaveLength(2);

    await user.click(orders);
    expect(await screen.findByRole('region', { name: 'Orders over time' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Total sales over time' })).toBeNull();

    await user.click(orders);
    expect(screen.queryByRole('region', { name: / over time/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Chart of Sessions' }));
    expect(await screen.findByRole('region', { name: 'Sessions over time' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close chart' }));
    expect(screen.queryByRole('region', { name: / over time/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Chart of Conversion rate' }));
    expect(await screen.findByRole('region', { name: 'Conversion rate over time' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: / over time/ })).toBeNull());
  });
});

describe('setup guide', () => {
  const fresh: TaskSignals = { passwordProtected: true, payments: { bankTransfer: false, cod: false, stripe: false, stripeConfigured: false }, customDomain: false, emailDone: false, productCount: 0, theme: null, shippingMethods: 0, offsite: { configured: false, enabled: false } };
  const guide = (signals: TaskSignals, onLaunch = () => undefined) => <SetupGuide done={detectTasks(signals)} onLaunch={onLaunch} />;

  it('lists the pending tasks only, and ends with a card that counts the done ones and resumes with the last pending task', () => {
    wrap(guide({ ...fresh, productCount: 2, passwordProtected: false }));
    const cards = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-task'));
    expect(cards.map((c) => c.getAttribute('data-task'))).toEqual(['payments', 'domain', 'email', 'theme', 'shipping', 'backup']);
    const progress = screen.getByTestId('guide-progress');
    expect(cards[5]).toBe(progress);
    expect(progress).toHaveTextContent('2 of 8 tasks done');
    expect(progress).toHaveTextContent('Next task: Back up off the server');
    expect(within(progress).getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/settings/backup');
    expect(within(cards[0]!).getByRole('link', { name: 'Set up payments' })).toHaveAttribute('href', '/settings/payments');
  });

  it('runs the launch action from the first card of a protected store', async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    wrap(guide(fresh, onLaunch));
    await user.click(screen.getByRole('button', { name: 'Launch store' }));
    expect(onLaunch).toHaveBeenCalledOnce();
  });

  it('shows only the progress message once every task is done', () => {
    wrap(guide({ ...fresh, passwordProtected: false, payments: { ...fresh.payments!, cod: true }, customDomain: true, emailDone: true, productCount: 1, theme: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' }, shippingMethods: 1, offsite: { configured: true, enabled: true } }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByTestId('guide-progress')).toHaveTextContent('8 of 8 tasks done');
  });
});
