import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { PageHeader } from './PageHeader';

function header(path: string, props: React.ComponentProps<typeof PageHeader>) {
  return render(<I18nProvider><MemoryRouter initialEntries={[path]}><PageHeader {...props} /></MemoryRouter></I18nProvider>);
}

describe('page header navigation', () => {
  it('gives top-level lists a back link to Home, as in the reference', () => {
    header('/products', { title: 'Products' });
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
  });

  it('keeps the parent back link on nested lists', () => {
    header('/orders/drafts', { title: 'Drafts' });
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/orders');
  });

  it('preserves an explicitly supplied back link on a detail page', () => {
    header('/products/123', { title: 'Canvas bag', back: '/products' });
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/products');
  });
});
