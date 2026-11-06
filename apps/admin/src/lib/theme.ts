export type Theme = 'dark' | 'light' | 'system';
const KEY = 'shopme.theme';

/** Stored theme preference; light is the default (dark navy and system remain available). */
export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch { /* storage unavailable */ }
  return 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}
