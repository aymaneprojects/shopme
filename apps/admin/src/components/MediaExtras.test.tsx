import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { uploadFile } from '@shopme/ui';
import { I18nProvider } from '../i18n';
import { MediaExtras } from './MediaExtras';

vi.mock('@shopme/ui', async (original) => ({ ...await original<typeof import('@shopme/ui')>(), uploadFile: vi.fn() }));

it('keeps successful files when a later media upload fails', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const error = vi.fn();
  const existing = { key: 'saved', url: '/files/saved.mp4', name: 'saved.mp4', type: 'VIDEO' as const, persisted: true };
  vi.mocked(uploadFile).mockResolvedValueOnce({ id: 'first', filename: 'first.mp4', url: '/files/first.mp4', mimeType: 'video/mp4', byteSize: 5 }).mockRejectedValueOnce(new Error('Upload failed'));
  render(<I18nProvider><MediaExtras value={[existing]} onChange={change} onError={error} /></I18nProvider>);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, [new File(['first'], 'first.mp4', { type: 'video/mp4' }), new File(['second'], 'second.mp4', { type: 'video/mp4' })]);
  expect(error).toHaveBeenCalledWith('Upload failed');
  expect(change).toHaveBeenCalledExactlyOnceWith([existing, { key: 'new-first', url: '/files/first.mp4', name: 'first.mp4', type: 'VIDEO', persisted: false }]);
  expect(input.value).toBe('');
  expect(screen.getByRole('button', { name: /video|3D/i })).toBeEnabled();
});

it('leaves media unchanged on an initial failure and permits the same file to be retried', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const error = vi.fn();
  vi.mocked(uploadFile).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 'retry', filename: 'clip.mp4', url: '/files/clip.mp4', mimeType: 'video/mp4', byteSize: 4 });
  render(<I18nProvider><MediaExtras value={[]} onChange={change} onError={error} /></I18nProvider>);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['clip'], 'clip.mp4', { type: 'video/mp4' });
  await user.upload(input, file);
  expect(error).toHaveBeenCalledWith('Offline');
  expect(change).not.toHaveBeenCalled();
  await user.upload(input, file);
  expect(change).toHaveBeenCalledExactlyOnceWith([{ key: 'new-retry', url: '/files/clip.mp4', name: 'clip.mp4', type: 'VIDEO', persisted: false }]);
});
