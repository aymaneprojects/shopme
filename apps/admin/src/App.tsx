import { ToastProvider } from '@shopme/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { PageFallback, Shell } from './components/Shell';
import { I18nProvider, useT } from './i18n';
import { LoginPage, SetupPage } from './pages/Auth';
import { CollectionEditPage } from './pages/CollectionEdit';
import { CollectionsPage } from './pages/Collections';
import { InventoryPage } from './pages/Inventory';
import { ProductEditPage } from './pages/ProductEdit';
import { HomePage } from './pages/Home';
import { ProductsPage } from './pages/Products';
import { ComingSoon } from './pages/Simple';
import { SessionProvider, useSession } from './session';
import { Spinner } from '@shopme/ui';


// Commerce and online-store routes are code-split so the initial bundle stays small.
const L = (load: () => Promise<Record<string, unknown>>, name: string) => {
  const C = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return <Suspense fallback={<PageFallback />}><C /></Suspense>;
};

const router = createBrowserRouter(
  [{
    element: <Shell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/products', element: <ProductsPage /> },
      { path: '/products/:id', element: <ProductEditPage /> },
      { path: '/collections', element: <CollectionsPage /> },
      { path: '/collections/:id', element: <CollectionEditPage /> },
      { path: '/inventory', element: <InventoryPage /> },
      { path: '/orders', element: L(() => import('./pages/Orders'), 'OrdersPage') },
      { path: '/orders/drafts', element: L(() => import('./pages/orders/Drafts'), 'DraftsPage') },
      { path: '/orders/drafts/:id', element: L(() => import('./pages/orders/Drafts'), 'DraftEditPage') },
      { path: '/orders/:id', element: L(() => import('./pages/OrderDetail'), 'OrderDetailPage') },
      { path: '/customers', element: L(() => import('./pages/Customers'), 'CustomersPage') },
      { path: '/customers/new', element: L(() => import('./pages/CustomerEdit'), 'CustomerEditPage') },
      { path: '/customers/:id', element: L(() => import('./pages/Customers'), 'CustomerDetailPage') },
      { path: '/customers/:id/edit', element: L(() => import('./pages/CustomerEdit'), 'CustomerEditPage') },
      { path: '/discounts', element: L(() => import('./pages/Discounts'), 'DiscountsPage') },
      { path: '/discounts/:id', element: L(() => import('./pages/DiscountEdit'), 'DiscountEditPage') },
      {
        path: '/online-store', element: L(() => import('./pages/online-store/Themes'), 'OnlineStoreLayout'),
        children: [
          { index: true, element: L(() => import('./pages/online-store/Themes'), 'ThemesPage') },
          { path: 'pages', element: L(() => import('./pages/online-store/StorePages'), 'PagesListPage') },
          { path: 'pages/:id', element: L(() => import('./pages/online-store/StorePages'), 'PageEditPage') },
          { path: 'navigation', element: L(() => import('./pages/online-store/Menus'), 'MenusPage') },
          { path: 'blog-posts', element: L(() => import('./pages/online-store/BlogPosts'), 'BlogPostsPage') },
          { path: 'blog-posts/:id', element: L(() => import('./pages/online-store/BlogPosts'), 'BlogPostEditPage') },
          { path: 'blogs', element: L(() => import('./pages/online-store/BlogPosts'), 'BlogsPage') },
          { path: 'redirects', element: L(() => import('./pages/online-store/Redirects'), 'RedirectsPage') },
        ],
      },
      { path: '/online-store/themes/:id/editor', element: L(() => import('./pages/online-store/ThemeEditor'), 'ThemeEditorPage') },
      {
        path: '/settings', element: L(() => import('./pages/settings/Settings'), 'SettingsLayout'),
        children: [
          { index: true, element: L(() => import('./pages/settings/Settings'), 'SettingsIndex') },
          { path: 'general', element: L(() => import('./pages/settings/Settings'), 'GeneralSettings') },
          { path: 'payments', element: L(() => import('./pages/settings/Commerce'), 'PaymentsSettings') },
          { path: 'shipping', element: L(() => import('./pages/settings/Commerce'), 'ShippingSettings') },
          { path: 'taxes', element: L(() => import('./pages/settings/Commerce'), 'TaxesSettings') },
          { path: 'domains', element: L(() => import('./pages/settings/Settings'), 'DomainsSettings') },
          { path: 'languages', element: L(() => import('./pages/settings/Settings'), 'LanguagesSettings') },
          { path: 'users', element: L(() => import('./pages/settings/Team'), 'UsersSettings') },
          { path: 'notifications', element: L(() => import('./pages/settings/Notifications'), 'NotificationsSettings') },
          { path: 'notifications/:key', element: L(() => import('./pages/settings/Notifications'), 'NotificationEditPage') },
          { path: 'policies', element: L(() => import('./pages/settings/Policies'), 'PoliciesSettings') },
          { path: 'webhooks', element: L(() => import('./pages/settings/Webhooks'), 'WebhooksSettings') },
          { path: 'shopify-import', element: L(() => import('./pages/settings/ShopifyImport'), 'ShopifyImportSettings') },
        ],
      },
      { path: '*', element: <ComingSoon titleKey="nav.notFound" /> },
    ],
  }],
  { basename: '/admin' },
);

function Gate() {
  const { state } = useSession();
  const t = useT();
  if (state.status === 'loading') return <div className="grid min-h-screen place-items-center" role="status" aria-label={t('common.loading')}><Spinner /></div>;
  if (state.status === 'setup') return <SetupPage />;
  if (state.status === 'anonymous') return <LoginPage />;
  return <RouterProvider router={router} />;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10_000 } } });

export function App() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionProvider><Gate /></SessionProvider>
        </ToastProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
