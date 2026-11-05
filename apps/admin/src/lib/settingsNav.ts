import { ArchiveRestore, Bell, ShoppingBag, Braces, CreditCard, Download, Globe, Languages, MapPin, Receipt, ScrollText, Settings, ShieldCheck, Truck, Users, Webhook } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Key } from '../i18n';
import type { Permission } from './permissions';

export interface SettingsSection { id: string; key: Key; icon: ComponentType<{ className?: string }>; perm?: Permission }

/** Sections of the settings area, in the order of the settings sidebar. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', key: 'settings.general', icon: Settings },
  { id: 'users', key: 'settings.users', icon: Users, perm: 'staff' },
  { id: 'payments', key: 'settings.payments', icon: CreditCard },
  { id: 'checkout', key: 'settings.checkout', icon: ShoppingBag },
  { id: 'shipping', key: 'settings.shipping', icon: Truck },
  { id: 'taxes', key: 'settings.taxes', icon: Receipt },
  { id: 'locations', key: 'settings.locations', icon: MapPin },
  { id: 'domains', key: 'settings.domains', icon: Globe },
  { id: 'notifications', key: 'settings.notifications', icon: Bell },
  { id: 'metafields', key: 'settings.metafields', icon: Braces },
  { id: 'languages', key: 'settings.languages', icon: Languages },
  { id: 'policies', key: 'settings.policies', icon: ScrollText },
  { id: 'webhooks', key: 'settings.webhooks', icon: Webhook },
  { id: 'shopify-import', key: 'settings.shopifyImport', icon: Download },
  { id: 'security', key: 'settings.security', icon: ShieldCheck },
  { id: 'backup', key: 'settings.backup', icon: ArchiveRestore, perm: 'settings' },
];
