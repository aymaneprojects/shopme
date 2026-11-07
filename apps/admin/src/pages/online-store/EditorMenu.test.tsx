import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorMenu } from './EditorMenu';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('repositions an open editor menu when the viewport shrinks', () => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 224, bottom: 400, width: 224, height: 400, toJSON: () => ({}) });
  render(<EditorMenu label="Section actions" at={{ x: 1100, y: 700 }} onClose={vi.fn()} items={[{ key: 'copy', label: 'Copy', onSelect: vi.fn() }]} />);
  const menu = screen.getByRole('menu', { name: 'Section actions' });
  expect(menu).toHaveStyle({ left: '1052px', top: '396px' });
  vi.stubGlobal('innerWidth', 375);
  vi.stubGlobal('innerHeight', 260);
  fireEvent.resize(window);
  expect(menu).toHaveStyle({ left: '147px', top: '4px' });
});
