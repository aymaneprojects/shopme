import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { uploadFile } from '@shopme/ui';
import type { UploadedFile } from '@shopme/ui';
import { I18nProvider } from '../i18n';
import { mutate } from '../api';
import { Timeline } from './Timeline';

vi.mock('@shopme/ui', async (original) => ({ ...await original<typeof import('@shopme/ui')>(), uploadFile: vi.fn() }));
vi.mock('../session', () => ({ useShop: () => ({ user: { email: 'staff@example.test', firstName: 'A', lastName: 'B' } }) }));
vi.mock('../api', () => ({ gql: vi.fn(async () => ({ order: { events: { nodes: [] } } })), mutate: vi.fn(async () => ({})) }));

it.each(['ctrlKey', 'metaKey'] as const)('waits for attachments before posting through %s+Enter', async (modifier) => {
  vi.mocked(mutate).mockClear();
  let complete!: (file: UploadedFile) => void;
  vi.mocked(uploadFile).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><I18nProvider><Timeline kind="order" id="order-1" /></I18nProvider></QueryClientProvider>);
  const user = userEvent.setup();
  const comment = screen.getByRole('textbox');
  await user.type(comment, 'See attached');
  await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['image'], 'proof.png', { type: 'image/png' }));
  await act(async () => { fireEvent.keyDown(comment, { key: 'Enter', [modifier]: true }); });
  expect(mutate).not.toHaveBeenCalled();
  await act(async () => { complete({ id: 'file-1', filename: 'proof.png', url: '/files/proof.png', mimeType: 'image/png', byteSize: 5 }); });
  await screen.findByText('proof.png');
  fireEvent.keyDown(comment, { key: 'Enter', [modifier]: true });
  await waitFor(() => expect(mutate).toHaveBeenCalledExactlyOnceWith(expect.any(String), { id: 'order-1', message: 'See attached', attachments: ['/files/proof.png'] }, 'orderTimelineCommentCreate'));
  client.clear();
});
