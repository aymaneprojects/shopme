import { useQuery } from '@tanstack/react-query';
import { gql } from '../api';
import { SHOP } from '../graphql';

interface ShopInfo { shop: { name: string; primaryDomain: { host: string; url: string }; myshopifyDomain: string; storefront: { passwordEnabled: boolean } } }

/** Public address and access state of the storefront, shared by the home page and the settings sidebar. */
export function useStoreInfo() {
  const q = useQuery({ queryKey: ['store-info'], staleTime: 30_000, queryFn: () => gql<ShopInfo>(SHOP) });
  const s = q.data?.shop;
  return {
    loaded: !!s,
    host: s?.primaryDomain.host ?? '',
    url: s?.primaryDomain.url ?? '',
    customDomain: !!s && s.primaryDomain.host !== s.myshopifyDomain,
    passwordProtected: s?.storefront.passwordEnabled ?? false,
  };
}
