import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { rest } from '../api';
import { LANGS, useI18n } from '../i18n';
import { Logo } from './Shell';

/** What the sign-in screens may offer, and the footer links (platform settings when set, else the ShopMe docs). */
export interface AuthMethods { passwordReset: boolean; passkeys: { rpId: string }; links: { help: string; terms: string | null; privacy: string | null } }
const FALLBACK_LINKS = { help: 'https://github.com/aymaneprojects/shopme/tree/main/docs', terms: null, privacy: null };
export const useAuthMethods = () => useQuery({ queryKey: ['auth-methods'], staleTime: 60_000, retry: false, queryFn: () => rest<AuthMethods>('/auth/methods') });

export type AuthCardSize = 'narrow' | 'default' | 'wide' | 'xwide';

/**
 * Frame of every signed-out screen: the dark navy backdrop (in light and dark admin themes alike), the logo top left, one centred white
 * card and a footer with help and terms.
 *  - `variant="login"`: the title is inside the card.
 *  - `variant="signup"`: a large title (and subtitle) above the card; the steps live inside it.
 */
export function AuthShell({ variant = 'login', title, subtitle, size, children }: { variant?: 'login' | 'signup'; title: string; subtitle?: ReactNode; size?: AuthCardSize; children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const links = useAuthMethods().data?.links ?? FALLBACK_LINKS;
  const signup = variant === 'signup';
  const cardSize = size ?? (signup ? 'narrow' : 'default');
  return (
    <div className="auth-page">
      <header className="flex items-center justify-between px-4 pt-6 sm:px-10 sm:pt-10">
        <div className="flex items-center gap-2.5 text-lg font-semibold text-white"><Logo className="size-8" /><span>ShopMe</span></div>
        <div className="relative">
        <select aria-label={t('auth.language')} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'fr')} className="auth-language">
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        {signup && (
          <div className="mb-6 max-w-xl text-center">
            <h1 className="text-[28px] font-semibold leading-tight text-white sm:text-[34px]">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] text-white/70">{subtitle}</p>}
          </div>
        )}
        <div className="auth-card auth-light" data-size={cardSize === 'default' ? undefined : cardSize}>
          {!signup && (
            <div className="mb-6">
              <h1 className="text-2xl font-bold leading-tight">{title}</h1>
              {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
            </div>
          )}
          {children}
        </div>
      </main>
      <footer className="px-4 pb-6 pt-2 text-center text-[12px] text-white/70">
        <a href={links.help} target="_blank" rel="noreferrer" className="mb-1.5 block text-[13px] font-semibold text-white hover:underline">{t('auth.help')}</a>
        <p className="mx-auto max-w-2xl">
          {t('auth.footer')}
          {links.terms && <> <a href={links.terms} target="_blank" rel="noreferrer" className="font-semibold text-white hover:underline">{t('auth.terms')}</a></>}
          {links.terms && links.privacy && <> · </>}
          {links.privacy && <a href={links.privacy} target="_blank" rel="noreferrer" className="font-semibold text-white hover:underline">{t('auth.privacy')}</a>}
        </p>
      </footer>
    </div>
  );
}
