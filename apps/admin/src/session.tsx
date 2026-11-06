import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, UNAUTHORIZED_EVENT, currentStoreHandle, handleFromPath, rest, setStoreHandle } from './api';

export interface User { id: number; shopId: number; email: string; firstName: string; lastName: string; role: 'owner' | 'admin' | 'staff' }
export interface Shop { id: number; name: string; email: string; currency: string; country: string; locale: string; timezone: string; weightUnit: string; handle?: string; status?: string; url?: string }

/** A store of the signed-in account (multi-store mode). */
export interface AccountStore { id: number; name: string; handle: string; status: string; role: string; primaryDomain: string | null; currency: string; testMode: boolean; host: string; url: string }
export interface Account { id: number; email: string; firstName: string | null; lastName: string | null; platformOwner: boolean }
/** Multi-store mode: the sign-in account, its stores, and what it may do on the installation. */
export interface MultiStore { account: Account; stores: AccountStore[]; canCreateStores: boolean; storeHandle: string | null; suspended: boolean }

export type SessionState =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User; shop: Shop; /** The shop requires two-step verification and this member has not set it up. */ twoFactorSetupRequired?: boolean; multi?: MultiStore; /** Embedded in the desktop app. */ desktop?: boolean }
  /** Multi-store mode, signed in, no store open: the account pages (stores, create a store, platform). `forbidden`: the URL named a store the account cannot open. */
  | { status: 'account'; multi: MultiStore; forbidden?: string };

interface Me { user: User | null; shop: Shop | null; twoFactorSetupRequired?: boolean; multiStore?: boolean; account?: Account; stores?: AccountStore[]; canCreateStores?: boolean; storeHandle?: string | null; suspended?: boolean; desktop?: boolean }

interface SessionApi {
  state: SessionState;
  /** Store the result of login/setup. */
  signedIn: (r: { user: User | null; shop: Shop | null; twoFactorSetupRequired?: boolean; desktop?: boolean; account?: Account; storeHandle?: string | null }) => void;
  /** Re-read /auth/me (after the security settings changed). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

/** Staff invitation links: answered without a session. */
export const INVITE_PATH_RE = /^\/admin\/invite\/([^/?#]+)/;
/** Admin paths that belong to the account rather than to a store (multi-store mode). */
export const ACCOUNT_PATH_RE = /^\/admin\/(stores|platform)(\/|$)/;

const Ctx = createContext<SessionApi | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
};
/** For pages rendered inside the authenticated shell. */
export const useShop = () => {
  const { state } = useSession();
  if (state.status !== 'authenticated') throw new Error('Not authenticated');
  return state;
};
/** Multi-store details of the session, or null (single-store installation). */
export const useMulti = (): MultiStore | null => {
  const { state } = useSession();
  return state.status === 'authenticated' || state.status === 'account' ? state.multi ?? null : null;
};

const multiOf = (me: Me): MultiStore => ({ account: me.account!, stores: me.stores ?? [], canCreateStores: !!me.canCreateStores, storeHandle: me.storeHandle ?? null, suspended: !!me.suspended });

/**
 * Turn `/auth/me` into a state. Multi-store: a store URL opens that store; the account pages open without a store; any other
 * admin URL is moved under the store the session used last (or to the store list when the account has none). Returns null while
 * the page is being moved.
 */
function stateOf(me: Me): SessionState | null {
  if (!me.multiStore) return { status: 'authenticated', user: me.user!, shop: me.shop!, twoFactorSetupRequired: me.twoFactorSetupRequired, desktop: me.desktop };
  const multi = multiOf(me);
  const path = window.location.pathname;
  // The URL moved under a store after this page loaded (history change): reload so every request names that store.
  if (!currentStoreHandle() && handleFromPath(path)) { window.location.reload(); return null; }
  if (currentStoreHandle() && me.user && me.shop) return { status: 'authenticated', user: me.user, shop: me.shop, twoFactorSetupRequired: me.twoFactorSetupRequired, multi };
  if (!ACCOUNT_PATH_RE.test(path) && me.storeHandle) {
    const rest = path.replace(/^\/admin\/?/, '');
    window.location.replace(`/admin/store/${me.storeHandle}/${rest}${window.location.search}${window.location.hash}`);
    return null;
  }
  setStoreHandle(null);
  return { status: 'account', multi };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const qc = useQueryClient();

  const load = useCallback(async (): Promise<void> => {
    try {
      const me = await rest<Me>('/auth/me');
      const next = stateOf(me);
      if (next) setState(next);
    } catch (e) {
      // Multi-store: signed in, but not a staff member of the store in the URL.
      if (e instanceof ApiError && e.status === 403 && e.body?.multiStore) {
        const handle = currentStoreHandle();
        setStoreHandle(null);
        setState({ status: 'account', multi: multiOf(e.body as unknown as Me), forbidden: handle ?? undefined });
        return;
      }
      throw e;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { needsSetup } = await rest<{ needsSetup: boolean }>('/setup/status');
        if (needsSetup) return !cancelled && setState({ status: 'setup' });
        if (INVITE_PATH_RE.test(window.location.pathname)) return !cancelled && setState({ status: 'anonymous' });
        if (!cancelled) await load();
      } catch {
        if (!cancelled) setState({ status: 'anonymous' });
      }
    })();
    const onUnauthorized = () => { qc.clear(); setState({ status: 'anonymous' }); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { cancelled = true; window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, [qc, load]);

  const signedIn = useCallback((r: { user: User | null; shop: Shop | null; twoFactorSetupRequired?: boolean; desktop?: boolean; account?: Account; storeHandle?: string | null }) => {
    // Multi-store: the session belongs to the account; /auth/me tells which store this tab opens.
    if (r.account || r.storeHandle !== undefined) { setState({ status: 'loading' }); void load().catch(() => setState({ status: 'anonymous' })); return; }
    setState({ status: 'authenticated', user: r.user!, shop: r.shop!, twoFactorSetupRequired: r.twoFactorSetupRequired, desktop: r.desktop });
  }, [load]);
  const refresh = useCallback(async () => { await load(); }, [load]);
  const logout = useCallback(async () => {
    await rest('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    qc.clear();
    setState({ status: 'anonymous' });
  }, [qc]);

  return <Ctx.Provider value={{ state, signedIn, refresh, logout }}>{children}</Ctx.Provider>;
}
