import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { PreviewDataMenu } from './PreviewDataMenu';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps an open preview-data panel within the resized viewport', async () => {
  vi.stubGlobal('innerWidth', 1280);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  render(<I18nProvider><PreviewDataMenu choices={undefined} value={{}} onChange={() => {}} /></I18nProvider>);
  const button = screen.getByRole('button', { name: 'Preview data' });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ right: 970, bottom: 39 } as DOMRect);
  await userEvent.click(button);
  const panel = screen.getByRole('dialog', { name: 'Preview data' });
  expect(panel.style.left).toBe('670px');
  vi.stubGlobal('innerWidth', 375);
  fireEvent(window, new Event('resize'));
  expect(panel.style.left).toBe('67px');
});

it('keeps Escape dismissal and trigger focus restoration', async () => {
  render(<I18nProvider><PreviewDataMenu choices={undefined} value={{}} onChange={() => {}} /></I18nProvider>);
  const button = screen.getByRole('button', { name: 'Preview data' });
  await userEvent.click(button);
  screen.getByRole('combobox', { name: 'Product' }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});
