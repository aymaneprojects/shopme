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
import { SecuritySettings } from './pages/settings/Security';
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
      { path: '/products/bulk', element: L(() => import('./pages/BulkEdit'), 'BulkEditPage') },
      { path: '/collections', element: <CollectionsPage /> },
      { path: '/collections/:id', element: <CollectionEditPage /> },
      { path: '/inventory', element: <InventoryPage /> },
      { path: '/transfers', element: L(() => import('./pages/transfers/List'), 'TransfersPage') },
      { path: '/transfers/new', element: L(() => import('./pages/transfers/Form'), 'TransferCreatePage') },
      { path: '/transfers/:id', element: L(() => import('./pages/transfers/Detail'), 'TransferDetailPage') },
      { path: '/transfers/:id/receive/:shipmentId', element: L(() => import('./pages/transfers/Receive'), 'TransferReceivePage') },
      { path: '/purchase-orders', element: L(() => import('./pages/purchase-orders/List'), 'PurchaseOrdersPage') },
      { path: '/purchase-orders/new', element: L(() => import('./pages/purchase-orders/Form'), 'PurchaseOrderCreatePage') },
      { path: '/purchase-orders/:id', element: L(() => import('./pages/purchase-orders/Detail'), 'PurchaseOrderDetailPage') },
      { path: '/purchase-orders/:id/receive', element: L(() => import('./pages/purchase-orders/Receive'), 'PurchaseOrderReceivePage') },
      { path: '/analytics', element: L(() => import('./pages/Analytics'), 'AnalyticsPage') },
      { path: '/analytics/reports', element: L(() => import('./pages/Analytics'), 'ReportsListPage') },
      { path: '/analytics/reports/:name', element: L(() => import('./pages/Analytics'), 'ReportPage') },
      { path: '/analytics/:name', element: L(() => import('./pages/Analytics'), 'LegacyReportRedirect') },
      { path: '/gift-cards', element: L(() => import('./pages/GiftCards'), 'GiftCardsPage') },
      { path: '/gift-cards/:id', element: L(() => import('./pages/GiftCards'), 'GiftCardEditPage') },
      { path: '/orders', element: L(() => import('./pages/Orders'), 'OrdersPage') },
      { path: '/orders/abandoned', element: L(() => import('./pages/orders/Abandoned'), 'AbandonedPage') },
      { path: '/orders/abandoned/:id', element: L(() => import('./pages/orders/Abandoned'), 'AbandonedDetailPage') },
      { path: '/orders/drafts', element: L(() => import('./pages/orders/Drafts'), 'DraftsPage') },
      { path: '/orders/drafts/:id', element: L(() => import('./pages/orders/Drafts'), 'DraftEditPage') },
      { path: '/orders/:id/refund', element: L(() => import('./pages/orders/Refund'), 'RefundPage') },
      { path: '/orders/:id/edit', element: L(() => import('./pages/orders/OrderEdit'), 'OrderEditPage') },
      { path: '/orders/:id', element: L(() => import('./pages/OrderDetail'), 'OrderDetailPage') },
      { path: '/customers', element: L(() => import('./pages/Customers'), 'CustomersPage') },
      { path: '/customers/segments', element: L(() => import('./pages/Segments'), 'SegmentsPage') },
      { path: '/customers/segments/:id', element: L(() => import('./pages/Segments'), 'SegmentEditPage') },
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
          { path: 'navigation/:id', element: L(() => import('./pages/online-store/Menus'), 'MenuEditPage') },
          { path: 'files', element: L(() => import('./pages/online-store/Files'), 'FilesPage') },
          { path: 'preferences', element: L(() => import('./pages/online-store/Preferences'), 'PreferencesPage') },
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
          { path: 'checkout', element: L(() => import('./pages/settings/Checkout'), 'CheckoutSettings') },
          { path: 'shipping', element: L(() => import('./pages/settings/Shipping'), 'ShippingSettings') },
          { path: 'shipping/profiles/:id', element: L(() => import('./pages/settings/ShippingProfile'), 'ShippingProfilePage') },
          { path: 'shipping/pickup', element: L(() => import('./pages/settings/Shipping'), 'PickupSettings') },
          { path: 'shipping/local-delivery', element: L(() => import('./pages/settings/Shipping'), 'LocalDeliverySettings') },
          { path: 'taxes', element: L(() => import('./pages/settings/Commerce'), 'TaxesSettings') },
          { path: 'domains', element: L(() => import('./pages/settings/Settings'), 'DomainsSettings') },
          { path: 'languages', element: L(() => import('./pages/settings/Languages'), 'LanguagesSettings') },
          { path: 'languages/translate', element: L(() => import('./pages/settings/Translations'), 'TranslationsPage') },
          { path: 'security', element: <SecuritySettings /> },
          { path: 'backup', element: L(() => import('./pages/settings/Backup'), 'BackupSettings') },
          { path: 'users', element: L(() => import('./pages/settings/Team'), 'UsersSettings') },
          { path: 'notifications', element: L(() => import('./pages/settings/Notifications'), 'NotificationsSettings') },
          { path: 'notifications/customer', element: L(() => import('./pages/settings/Notifications'), 'CustomerNotificationsPage') },
          { path: 'notifications/staff', element: L(() => import('./pages/settings/Notifications'), 'StaffNotificationsPage') },
          { path: 'notifications/:key', element: L(() => import('./pages/settings/Notifications'), 'NotificationEditPage') },
          { path: 'policies', element: L(() => import('./pages/settings/Policies'), 'PoliciesSettings') },
          { path: 'policies/:type', element: L(() => import('./pages/settings/Policies'), 'PolicyEditPage') },
          { path: 'webhooks', element: L(() => import('./pages/settings/Webhooks'), 'WebhooksSettings') },
          { path: 'locations', element: L(() => import('./pages/settings/Locations'), 'LocationsSettings') },
          { path: 'metafields', element: L(() => import('./pages/settings/Metafields'), 'MetafieldsSettings') },
          { path: 'metafields/:owner', element: L(() => import('./pages/settings/Metafields'), 'MetafieldDefinitionsPage') },
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
  if (state.twoFactorSetupRequired) return <div className="mx-auto max-w-2xl p-4 md:p-8"><SecuritySettings forced /></div>;
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
