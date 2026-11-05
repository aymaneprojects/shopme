import { eq } from 'drizzle-orm';
import { shops } from '../../db/schema';
import type { Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import type { Shop } from '../shops';

/**
 * Customer accounts settings (Settings > Customer accounts), stored in `shops.settings.customerAccounts`.
 * The mode is the one source of truth for "must the buyer sign in": Settings > Checkout reads and writes it too
 * (`required` there is `REQUIRED` here), so the two pages never disagree.
 */
export const ACCOUNTS_MODES = ['DISABLED', 'OPTIONAL', 'REQUIRED'] as const;
export type AccountsMode = (typeof ACCOUNTS_MODES)[number];

export interface CustomerAccountsSettings {
  mode: AccountsMode;
  /** Show the sign-in links in the storefront header and at checkout. */
  loginLinksVisible: boolean;
  signIn: { password: boolean; emailCode: boolean };
  orderActions: { reorder: boolean; returns: boolean; cancellations: boolean; cancellationWindowHours: number };
  /** Let customers see and spend their store credit (`settings.storeCredit.enabled`). */
  storeCredit: boolean;
  /** Custom account URL (a path or an absolute URL the storefront account link points to). Null = `/account`. */
  url: string | null;
}

export const DEFAULT_ACCOUNTS_SETTINGS: CustomerAccountsSettings = {
  mode: 'OPTIONAL', loginLinksVisible: true, signIn: { password: true, emailCode: false },
  orderActions: { reorder: true, returns: false, cancellations: false, cancellationWindowHours: 24 }, storeCredit: false, url: null,
};

const isMode = (v: unknown): v is AccountsMode => (ACCOUNTS_MODES as readonly unknown[]).includes(v);

/** The accounts mode: the stored one, else what the legacy checkout option said (`accountMode: 'required'`). */
export function accountsModeOf(shop: Pick<Shop, 'settings'>): AccountsMode {
  const st = shop.settings as Record<string, any>;
  if (isMode(st.customerAccounts?.mode)) return st.customerAccounts.mode;
  return st.checkout?.accountMode === 'required' ? 'REQUIRED' : 'OPTIONAL';
}

export function customerAccountsSettingsOf(shop: Pick<Shop, 'settings'>): CustomerAccountsSettings {
  const st = shop.settings as Record<string, any>;
  const c = (st.customerAccounts ?? {}) as Record<string, any>;
  const d = DEFAULT_ACCOUNTS_SETTINGS;
  const hours = Number(c.orderActions?.cancellationWindowHours);
  const signIn = { password: c.signIn?.password !== false, emailCode: c.signIn?.emailCode === true };
  if (!signIn.password && !signIn.emailCode) signIn.password = true;
  return {
    mode: accountsModeOf(shop), loginLinksVisible: c.loginLinksVisible !== false, signIn,
    orderActions: {
      reorder: c.orderActions?.reorder ?? d.orderActions.reorder, returns: c.orderActions?.returns === true, cancellations: c.orderActions?.cancellations === true,
      cancellationWindowHours: Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : d.orderActions.cancellationWindowHours,
    },
    storeCredit: st.storeCredit?.enabled === true, url: typeof c.url === 'string' && c.url.trim() ? c.url.trim() : null,
  };
}

/** Settings object after switching the accounts mode: keeps `checkout.accountMode` (the legacy field) in step. */
export function withAccountsMode(settings: Record<string, unknown>, mode: AccountsMode): Record<string, unknown> {
  const checkout = { ...((settings.checkout ?? {}) as Record<string, unknown>), accountMode: mode === 'REQUIRED' ? 'required' : 'guest' };
  return { ...settings, checkout, customerAccounts: { ...((settings.customerAccounts ?? {}) as Record<string, unknown>), mode } };
}

export interface CustomerAccountsInput {
  mode?: AccountsMode | null;
  loginLinksVisible?: boolean | null;
  signIn?: { password?: boolean | null; emailCode?: boolean | null } | null;
  orderActions?: { reorder?: boolean | null; returns?: boolean | null; cancellations?: boolean | null; cancellationWindowHours?: number | null } | null;
  storeCredit?: boolean | null;
  url?: string | null;
}

const validUrl = (u: string) => (u.startsWith('/') && !u.startsWith('//')) || /^https?:\/\/[^\s]+$/i.test(u);

export async function updateCustomerAccountsSettings(db: Executor, shop: Shop, input: CustomerAccountsInput): Promise<Result<CustomerAccountsSettings>> {
  const cur = customerAccountsSettingsOf(shop);
  if (input.mode != null && !isMode(input.mode)) return errR(['mode'], 'Mode is invalid', 'INVALID');
  const signIn = { password: input.signIn?.password ?? cur.signIn.password, emailCode: input.signIn?.emailCode ?? cur.signIn.emailCode };
  if (!signIn.password && !signIn.emailCode) return errR(['signIn'], 'Keep at least one sign-in method on', 'INVALID');
  const hours = input.orderActions?.cancellationWindowHours ?? cur.orderActions.cancellationWindowHours;
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return errR(['orderActions', 'cancellationWindowHours'], 'The cancellation window is between 1 and 720 hours', 'INVALID');
  let url = cur.url;
  if (input.url !== undefined) {
    url = input.url?.trim() ? input.url.trim() : null;
    if (url && !validUrl(url)) return errR(['url'], 'Use a path starting with / or a full http(s) address', 'INVALID');
  }
  const next: CustomerAccountsSettings = {
    mode: input.mode ?? cur.mode, loginLinksVisible: input.loginLinksVisible ?? cur.loginLinksVisible, signIn,
    orderActions: {
      reorder: input.orderActions?.reorder ?? cur.orderActions.reorder, returns: input.orderActions?.returns ?? cur.orderActions.returns,
      cancellations: input.orderActions?.cancellations ?? cur.orderActions.cancellations, cancellationWindowHours: hours,
    },
    storeCredit: input.storeCredit ?? cur.storeCredit, url,
  };
  const { storeCredit, mode, ...stored } = next;
  const base = withAccountsMode(shop.settings as Record<string, unknown>, mode);
  const settings = {
    ...base, customerAccounts: { ...(base.customerAccounts as object), ...stored },
    storeCredit: { ...((shop.settings as Record<string, any>).storeCredit ?? {}), enabled: storeCredit },
  };
  await db.update(shops).set({ settings, updatedAt: new Date() }).where(eq(shops.id, shop.id));
  return okR(next);
}

/** Where the storefront account link points. */
export const accountUrlOf = (shop: Pick<Shop, 'settings'>): string => customerAccountsSettingsOf(shop).url ?? '/account';
