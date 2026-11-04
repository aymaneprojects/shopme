import { ToastProvider } from '@shopme/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Shell } from './components/Shell';
import { I18nProvider, useT } from './i18n';
import { LoginPage, SetupPage } from './pages/Auth';
import { CollectionEditPage } from './pages/CollectionEdit';
import { CollectionsPage } from './pages/Collections';
import { InventoryPage } from './pages/Inventory';
import { ProductEditPage } from './pages/ProductEdit';
import { ProductsPage } from './pages/Products';
import { ComingSoon, HomePage } from './pages/Simple';
import { SessionProvider, useSession } from './session';
import { Spinner } from '@shopme/ui';

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
      { path: '/orders/*', element: <ComingSoon titleKey="nav.orders" /> },
      { path: '/customers/*', element: <ComingSoon titleKey="nav.customers" /> },
      { path: '/discounts/*', element: <ComingSoon titleKey="nav.discounts" /> },
      { path: '/online-store/*', element: <ComingSoon titleKey="nav.onlineStore" /> },
      { path: '/settings/*', element: <ComingSoon titleKey="nav.settings" /> },
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
