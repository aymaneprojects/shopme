import { useSession } from '../session';

/**
 * Link to a page of this tab's storefront. Single-store: the path itself (the storefront shares the admin's host). Multi-store:
 * the store's own origin (its primary domain, else `<handle>.<base domain>`), since the admin host serves no storefront.
 */
export function useStorefrontUrl(): (path: string) => string {
  const { state } = useSession();
  const origin = state.status === 'authenticated' && state.multi ? state.shop.url ?? '' : '';
  return (path: string) => `${origin}${path}`;
}
