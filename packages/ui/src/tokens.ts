/** Design tokens as CSS variable references. Values live in tokens.css. */
export const tokens = {
  color: {
    primary: 'var(--color-primary)',
    primaryHover: 'var(--color-primary-hover)',
    primarySubtle: 'var(--color-primary-subtle)',
    primaryContrast: 'var(--color-primary-contrast)',
    focusRing: 'var(--color-focus-ring)',
    bg: 'var(--color-bg)',
    surface: 'var(--color-surface)',
    border: 'var(--color-border)',
    text: 'var(--color-text)',
    textMuted: 'var(--color-text-muted)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    critical: 'var(--color-critical)',
  },
  radius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
  font: { sans: 'var(--font-sans)' },
} as const;

/** Raw light-mode brand values, for tooling that cannot read CSS variables. */
export const brand = { primary: '#1E40AF', primaryHover: '#1E3A8A', primarySubtle: '#DBEAFE' } as const;
