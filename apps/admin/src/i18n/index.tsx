import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en, type Key } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';
export type { Key };
const dicts: Record<Lang, Record<Key, string>> = { en, fr };
export const LANGS: Array<{ id: Lang; label: string }> = [{ id: 'en', label: 'English' }, { id: 'fr', label: 'Français' }];
const STORAGE_KEY = 'shopme.lang';

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch { /* storage unavailable */ }
  return (typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (key: Key, vars?: Record<string, string | number>) => string }

export const translate = (lang: Lang, key: Key, vars?: Record<string, string | number>) =>
  (dicts[lang][key] ?? en[key]).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''));

const Ctx = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v) });
export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? detectLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
