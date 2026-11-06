import { EmailPanel } from '../../components/EmailSetup';
import { storeEmailApi } from '../../lib/emailApi';
import { useShopSettings } from './Settings';

/** Settings > E-mails: one simple screen (the 3 DNS lines, "Check", a test e-mail), details and advanced options folded away. */
export function EmailsSettings() {
  const shop = useShopSettings();
  return <EmailPanel api={storeEmailApi} defaultTo={shop.data?.shop.email ?? ''} />;
}
