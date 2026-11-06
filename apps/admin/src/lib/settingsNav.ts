import { ArchiveRestore, Mail, Radio, Store, Bell, Lock, MousePointerClick, ShoppingBag, UserRound, Braces, CreditCard, Download, Globe, Languages, MapPin, Receipt, ScrollText, Settings, Truck, Users, Webhook } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Key } from '../i18n';
import type { Permission } from './permissions';

export interface SettingsSection { id: string; /** Sub-pages listed under the section while it is open (Users: Roles, Security). */ children?: Array<{ to: string; key: Key }>; /** Link target when the section is a page outside /settings. */ to?: string; key: Key; icon: ComponentType<{ className?: string }>; perm?: Permission }

/** Sections of the settings area, in the order of the settings sidebar. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', key: 'settings.general', icon: Settings },
  { id: 'users', key: 'settings.nav.users', icon: Users, perm: 'staff', children: [{ to: '/settings/users/roles', key: 'bs.roles' }, { to: '/settings/security', key: 'usec.title' }] },
  { id: 'payments', key: 'settings.payments', icon: CreditCard },
  { id: 'checkout', key: 'settings.checkout', icon: ShoppingBag },
  { id: 'accounts', key: 'settings.accounts', icon: UserRound },
  { id: 'shipping', key: 'settings.shipping', icon: Truck },
  { id: 'taxes', key: 'settings.taxes', icon: Receipt },
  { id: 'locations', key: 'settings.locations', icon: MapPin },
  { id: 'markets', key: 'nav.markets', icon: Store },
  { id: 'channels', to: '/channels', key: 'nav.salesChannels', icon: Radio },
  { id: 'domains', key: 'settings.domains', icon: Globe },
  { id: 'events', key: 'settings.events', icon: MousePointerClick },
  { id: 'notifications', key: 'settings.notifications', icon: Bell },
  { id: 'emails', key: 'settings.emails', icon: Mail },
  { id: 'metafields', key: 'settings.metafields', icon: Braces },
  { id: 'languages', key: 'settings.languages', icon: Languages },
  { id: 'privacy', key: 'settings.privacy', icon: Lock },
  { id: 'policies', key: 'settings.policies', icon: ScrollText },
  { id: 'webhooks', key: 'settings.webhooks', icon: Webhook },
  { id: 'backup', key: 'settings.backup', icon: ArchiveRestore, perm: 'settings' },
  { id: 'shopify-import', key: 'settings.shopifyImport', icon: Download },
];
