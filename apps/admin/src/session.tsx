import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UNAUTHORIZED_EVENT, rest } from './api';

export interface User { id: number; shopId: number; email: string; firstName: string; lastName: string; role: 'owner' | 'admin' | 'staff' }
export interface Shop { id: number; name: string; email: string; currency: string; country: string; locale: string; timezone: string; weightUnit: string }

export type SessionState =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User; shop: Shop; /** The shop requires two-step verification and this member has not set it up. */ twoFactorSetupRequired?: boolean };

interface SessionApi {
  state: SessionState;
  /** Store the result of login/setup. */
  signedIn: (r: { user: User; shop: Shop; twoFactorSetupRequired?: boolean }) => void;
  /** Re-read /auth/me (after the security settings changed). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { needsSetup } = await rest<{ needsSetup: boolean }>('/setup/status');
        if (needsSetup) return !cancelled && setState({ status: 'setup' });
        const me = await rest<{ user: User; shop: Shop; twoFactorSetupRequired?: boolean }>('/auth/me');
        if (!cancelled) setState({ status: 'authenticated', ...me });
      } catch {
        if (!cancelled) setState({ status: 'anonymous' });
      }
    })();
    const onUnauthorized = () => { qc.clear(); setState({ status: 'anonymous' }); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { cancelled = true; window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, [qc]);

  const signedIn = useCallback((r: { user: User; shop: Shop; twoFactorSetupRequired?: boolean }) => setState({ status: 'authenticated', ...r }), []);
  const refresh = useCallback(async () => { const me = await rest<{ user: User; shop: Shop; twoFactorSetupRequired?: boolean }>('/auth/me'); setState({ status: 'authenticated', ...me }); }, []);
  const logout = useCallback(async () => {
    await rest('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    qc.clear();
    setState({ status: 'anonymous' });
  }, [qc]);

  return <Ctx.Provider value={{ state, signedIn, refresh, logout }}>{children}</Ctx.Provider>;
}
