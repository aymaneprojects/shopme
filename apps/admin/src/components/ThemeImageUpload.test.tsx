import { ImageUploader } from '@shopme/ui';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setStoreHandle } from '../api';
import { I18nProvider } from '../i18n';
import { SettingField } from './SettingField';

afterEach(() => { setStoreHandle(null); vi.unstubAllGlobals(); });

it.each([null, 'second-store'])('uploads a theme image in the active store (%s)', async (handle) => {
  setStoreHandle(handle);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ file: { url: '/files/hero.jpg', filename: 'hero.jpg' } }));
  vi.stubGlobal('fetch', fetcher);
  const change = vi.fn();
  const { container } = render(<I18nProvider initial="en"><SettingField def={{ type: 'image_picker', id: 'hero' }} label="Hero image" value="" optionLabel={(s) => s ?? ''} onChange={change} /></I18nProvider>);
  const file = new File(['image'], 'hero.jpg', { type: 'image/jpeg' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith('/files/hero.jpg'));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [endpoint, init] = fetcher.mock.calls[0]!;
  expect(endpoint).toBe(handle ? '/admin/store/second-store/api/files' : '/admin/api/files');
  const upload = (init.body as FormData).get('file') as File;
  expect(upload.name).toBe('hero.jpg');
  expect(upload.type).toBe('image/jpeg');
});

it('preserves the default endpoint for standalone UI consumers', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ file: { url: '/files/image.jpg' } }));
  vi.stubGlobal('fetch', fetcher);
  const uploaded = vi.fn();
  const { container } = render(<ImageUploader label="Upload" onUploaded={uploaded} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'image.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(uploaded).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls[0]![0]).toBe('/admin/api/files');
});
