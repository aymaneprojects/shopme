import { ToastProvider } from '@shopme/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { Navigate, createBrowserRouter } from 'react-router';
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
      {
        path: '/content', element: L(() => import('./pages/Content'), 'ContentLayout'),
        children: [
          { index: true, element: <Navigate to="/content/metaobjects" replace /> },
          { path: 'files', element: L(() => import('./pages/online-store/Files'), 'FilesPage') },
          { path: 'navigation', element: L(() => import('./pages/online-store/Menus'), 'MenusPage') },
          { path: 'navigation/:id', element: L(() => import('./pages/online-store/Menus'), 'MenuEditPage') },
          { path: 'blog-posts', element: L(() => import('./pages/online-store/BlogPosts'), 'BlogPostsPage') },
          { path: 'blog-posts/:id', element: L(() => import('./pages/online-store/BlogPosts'), 'BlogPostEditPage') },
        ],
      },
      { path: '/content/metaobjects', element: L(() => import('./pages/Metaobjects'), 'MetaobjectsPage') },
      { path: '/content/entries', element: L(() => import('./pages/Metaobjects'), 'AllMetaobjectEntriesPage') },
      { path: '/content/metaobjects/:type', element: L(() => import('./pages/Metaobjects'), 'MetaobjectEntriesPage') },
      { path: '/content/metaobjects/:type/:id', element: L(() => import('./pages/MetaobjectEntry'), 'MetaobjectEntryPage') },
      { path: '/analytics', element: L(() => import('./pages/Analytics'), 'AnalyticsPage') },
      { path: '/analytics/live', element: L(() => import('./pages/AnalyticsExplore'), 'LiveViewPage') },
      { path: '/analytics/explorations/:id', element: L(() => import('./pages/AnalyticsExplore'), 'ExplorationPage') },
      { path: '/analytics/reports', element: L(() => import('./pages/Analytics'), 'ReportsListPage') },
      { path: '/analytics/reports/:name', element: L(() => import('./pages/Analytics'), 'ReportPage') },
      { path: '/analytics/:name', element: L(() => import('./pages/Analytics'), 'LegacyReportRedirect') },
      { path: '/gift-cards', element: L(() => import('./pages/GiftCards'), 'GiftCardsPage') },
      { path: '/gift-cards/:id', element: L(() => import('./pages/GiftCards'), 'GiftCardEditPage') },
      { path: '/orders', element: L(() => import('./pages/Orders'), 'OrdersPage') },
      { path: '/orders/abandoned', element: L(() => import('./pages/orders/Abandoned'), 'AbandonedPage') },
      { path: '/orders/abandoned/:id', element: L(() => import('./pages/orders/Abandoned'), 'AbandonedDetailPage') },
      { path: '/orders/shipping-labels', element: L(() => import('./pages/orders/ShippingLabels'), 'ShippingLabelsPage') },
      { path: '/orders/drafts', element: L(() => import('./pages/orders/Drafts'), 'DraftsPage') },
      { path: '/orders/drafts/:id', element: L(() => import('./pages/orders/Drafts'), 'DraftEditPage') },
      { path: '/orders/:id/refund', element: L(() => import('./pages/orders/Refund'), 'RefundPage') },
      { path: '/orders/:id/edit', element: L(() => import('./pages/orders/OrderEdit'), 'OrderEditPage') },
      { path: '/orders/:id', element: L(() => import('./pages/OrderDetail'), 'OrderDetailPage') },
      { path: '/marketing', element: L(() => import('./pages/Marketing'), 'MarketingPage') },
      { path: '/channels', element: L(() => import('./pages/Channels'), 'ChannelsPage') },
      { path: '/customers', element: L(() => import('./pages/Customers'), 'CustomersPage') },
      { path: '/customers/companies', element: L(() => import('./pages/Companies'), 'CompaniesPage') },
      { path: '/customers/companies/:id', element: L(() => import('./pages/Companies'), 'CompanyDetailPage') },
      { path: '/customers/segments', element: L(() => import('./pages/Segments'), 'SegmentsPage') },
      { path: '/customers/segments/:id', element: L(() => import('./pages/Segments'), 'SegmentEditPage') },
      { path: '/customers/new', element: L(() => import('./pages/CustomerEdit'), 'CustomerEditPage') },
      { path: '/customers/:id', element: L(() => import('./pages/Customers'), 'CustomerDetailPage') },
      { path: '/customers/:id/edit', element: L(() => import('./pages/CustomerEdit'), 'CustomerEditPage') },
      { path: '/markets', element: L(() => import('./pages/markets/Markets'), 'MarketsPage') },
      { path: '/markets/catalogs', element: L(() => import('./pages/markets/Catalogs'), 'CatalogsPage') },
      { path: '/markets/catalogs/:id', element: L(() => import('./pages/markets/CatalogEdit'), 'CatalogEditPage') },
      { path: '/markets/rollouts', element: L(() => import('./pages/markets/Rollouts'), 'RolloutsPage') },
      { path: '/markets/:id', element: L(() => import('./pages/markets/MarketDetail'), 'MarketDetailPage') },
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
      { path: '/online-store/themes/:id/code', element: L(() => import('./pages/online-store/ThemeCode'), 'ThemeCodePage') },
      { path: '/online-store/themes/:id/content', element: L(() => import('./pages/online-store/ThemeContent'), 'ThemeContentPage') },
      {
        path: '/settings', element: L(() => import('./pages/settings/Settings'), 'SettingsLayout'),
        children: [
          { index: true, element: L(() => import('./pages/settings/Settings'), 'SettingsIndex') },
          { path: 'general', element: L(() => import('./pages/settings/General'), 'GeneralSettings') },
          { path: 'payments', element: L(() => import('./pages/settings/Payments'), 'PaymentsSettings') },
          { path: 'checkout', element: L(() => import('./pages/settings/Checkout'), 'CheckoutSettings') },
          { path: 'shipping', element: L(() => import('./pages/settings/Shipping'), 'ShippingSettings') },
          { path: 'shipping/profiles/:id', element: L(() => import('./pages/settings/ShippingProfile'), 'ShippingProfilePage') },
          { path: 'shipping/documents', element: L(() => import('./pages/settings/Documents'), 'DocumentsSettings') },
          { path: 'documents/:type/:id', element: L(() => import('./pages/settings/Documents'), 'PrintDocumentPage') },
          { path: 'shipping/pickup', element: L(() => import('./pages/settings/Shipping'), 'PickupSettings') },
          { path: 'shipping/local-delivery', element: L(() => import('./pages/settings/Shipping'), 'LocalDeliverySettings') },
          { path: 'accounts', element: L(() => import('./pages/settings/CustomerAccounts'), 'CustomerAccountsSettings') },
          { path: 'privacy', element: L(() => import('./pages/settings/CustomerPrivacy'), 'CustomerPrivacySettings') },
          { path: 'privacy/cookie-banner', element: L(() => import('./pages/settings/CustomerPrivacy'), 'CookieBannerPage') },
          { path: 'privacy/data-sale', element: L(() => import('./pages/settings/CustomerPrivacy'), 'DataSalePage') },
          { path: 'privacy/marketing', element: L(() => import('./pages/settings/CustomerPrivacy'), 'MarketingPage') },
          { path: 'privacy/double-opt-in', element: L(() => import('./pages/settings/CustomerPrivacy'), 'DoubleOptInPage') },
          { path: 'events', element: L(() => import('./pages/settings/CustomerEvents'), 'CustomerEventsSettings') },
          { path: 'events/:id', element: L(() => import('./pages/settings/CustomerEvents'), 'PixelPage') },
          { path: 'markets', element: <Navigate to="/markets" replace /> },
          { path: 'taxes', element: L(() => import('./pages/settings/Taxes'), 'TaxesSettings') },
          { path: 'taxes/:country', element: L(() => import('./pages/settings/Taxes'), 'TaxRegionPage') },
          { path: 'domains', element: L(() => import('./pages/settings/Settings'), 'DomainsSettings') },
          { path: 'languages', element: L(() => import('./pages/settings/Languages'), 'LanguagesSettings') },
          { path: 'languages/translate', element: L(() => import('./pages/settings/Translations'), 'TranslationsPage') },
          { path: 'security', element: <SecuritySettings /> },
          { path: 'backup', element: L(() => import('./pages/settings/Backup'), 'BackupSettings') },
          { path: 'users', element: L(() => import('./pages/settings/Team'), 'UsersSettings') },
          { path: 'users/roles', element: L(() => import('./pages/settings/Team'), 'RolesSettings') },
          { path: 'notifications', element: L(() => import('./pages/settings/Notifications'), 'NotificationsSettings') },
          { path: 'notifications/customer', element: L(() => import('./pages/settings/Notifications'), 'CustomerNotificationsPage') },
          { path: 'notifications/staff', element: L(() => import('./pages/settings/Notifications'), 'StaffNotificationsPage') },
          { path: 'notifications/:key', element: L(() => import('./pages/settings/Notifications'), 'NotificationEditPage') },
          { path: 'policies', element: L(() => import('./pages/settings/Policies'), 'PoliciesSettings') },
          { path: 'policies/:type', element: L(() => import('./pages/settings/Policies'), 'PolicyEditPage') },
          { path: 'webhooks', element: L(() => import('./pages/settings/Webhooks'), 'WebhooksSettings') },
          { path: 'locations', element: L(() => import('./pages/settings/Locations'), 'LocationsSettings') },
          { path: 'metafields', element: L(() => import('./pages/settings/Metafields'), 'MetafieldsSettings') },
          { path: 'metafields/metaobjects', element: L(() => import('./pages/settings/MetaobjectDefinitions'), 'MetaobjectDefinitionsPage') },
          { path: 'metafields/metaobjects/:id', element: L(() => import('./pages/settings/MetaobjectDefinitions'), 'MetaobjectDefinitionEditPage') },
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
