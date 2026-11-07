import { ToastProvider } from '@shopme/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { FreeImagesDialog } from './FreeImages';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => vi.unstubAllGlobals());

const image = () => new Response('image bytes', { headers: { 'content-type': 'image/jpeg' } });
const uploaded = () => Response.json({ file: { url: '/files/background.jpg' } });
function mount() {
  const onPick = vi.fn(), onClose = vi.fn();
  render(<I18nProvider initial="en"><ToastProvider><FreeImagesDialog open onPick={onPick} onClose={onClose} /></ToastProvider></I18nProvider>);
  return { onPick, onClose };
}

describe('free theme images', () => {
  it.each([
    ['HTTP failure', () => new Response('not found', { status: 404, headers: { 'content-type': 'image/jpeg' } })],
    ['HTML fallback', () => new Response('<html>Admin</html>', { headers: { 'content-type': 'text/html' } })],
  ] as const)('keeps %s out of uploads and allows retry', async (_name, response) => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher);
    const { onPick, onClose } = mount();
    await user.click(screen.getByRole('button', { name: 'Use image 1' }));
    expect(await screen.findByText('This image could not be loaded. Please try again.')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: 'Use image 1' });
    expect(retry).toBeEnabled();
    fetcher.mockResolvedValueOnce(image()).mockResolvedValueOnce(uploaded());
    await user.click(retry);
    await waitFor(() => expect(onPick).toHaveBeenCalledExactlyOnceWith('/files/background.jpg'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uploads a valid image and preserves its filename and media type', async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValueOnce(image()).mockResolvedValueOnce(uploaded());
    vi.stubGlobal('fetch', fetcher);
    const { onPick, onClose } = mount();
    await user.click(screen.getByRole('button', { name: 'Use image 1' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('/files/background.jpg'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetcher.mock.calls[1]!;
    expect(endpoint).toBe('/admin/api/files');
    const file = (init.body as FormData).get('file') as File;
    expect(file.name).toBe('abstract-01.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
