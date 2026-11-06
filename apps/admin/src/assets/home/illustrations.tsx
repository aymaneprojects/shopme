import type { ReactNode } from 'react';

// Setup guide scenes: simple shapes drawn for ShopMe, painted with the admin theme tokens so they follow the light and dark themes.
const C = { card: 'var(--color-bg)', line: 'var(--color-border)', main: 'var(--color-accent)', sub: 'var(--color-primary-subtle)', ink: 'var(--color-text)', soft: 'var(--color-text-muted)', ok: 'var(--color-success)', warm: 'var(--color-attention)' };
const stroke = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Scene({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 240 120" className="h-full w-full" aria-hidden focusable="false">{children}</svg>;
}

/** Rocket lifting off a browser window. */
export function LaunchArt() {
  return (
    <Scene>
      <rect x="40" y="28" width="116" height="74" rx="9" fill={C.card} stroke={C.line} strokeWidth="1.5" />
      <path d="M40 42h116" stroke={C.line} strokeWidth="1.5" /><circle cx="52" cy="35" r="2.5" fill={C.line} /><circle cx="61" cy="35" r="2.5" fill={C.line} /><circle cx="70" cy="35" r="2.5" fill={C.line} />
      <rect x="54" y="54" width="46" height="6" rx="3" fill={C.line} /><rect x="54" y="66" width="30" height="6" rx="3" fill={C.line} />
      <ellipse cx="148" cy="100" rx="30" ry="7" fill={C.sub} />
      <path d="M170 24c14 10 18 34 8 52l-16 0c-10-18-6-42 8-52z" fill={C.card} stroke={C.main} strokeWidth="2" transform="rotate(32 170 56)" />
      <circle cx="172" cy="50" r="6" fill={C.sub} stroke={C.main} strokeWidth="2" />
      <path d="M150 78c-8 2-12 8-12 16 8 0 14-4 16-12z" fill={C.main} />
      <path d="M137 98c-6 4-8 8-8 10M146 100c-2 5-2 8 0 11" stroke={C.warm} {...stroke} />
    </Scene>
  );
}

/** Card terminal with an approved payment. */
export function PaymentsArt() {
  return (
    <Scene>
      <rect x="82" y="14" width="76" height="96" rx="12" fill={C.card} stroke={C.line} strokeWidth="1.5" />
      <rect x="92" y="24" width="56" height="26" rx="5" fill={C.sub} />
      <path d="m110 37 5 5 10-11" stroke={C.ok} {...stroke} strokeWidth="2.5" />
      {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={98 + c * 22} cy={62 + r * 13} r="4" fill={C.line} />))}
      <g transform="rotate(-12 57 71)"><rect x="28" y="52" width="58" height="38" rx="6" fill={C.main} /><rect x="28" y="60" width="58" height="8" fill={C.card} opacity=".55" /><rect x="36" y="78" width="18" height="4" rx="2" fill={C.card} opacity=".75" /></g>
    </Scene>
  );
}

/** Address bar with a custom domain and a pointer. */
export function DomainArt() {
  return (
    <Scene>
      <rect x="30" y="38" width="180" height="42" rx="21" fill={C.card} stroke={C.line} strokeWidth="1.5" />
      <circle cx="54" cy="59" r="9" fill={C.sub} stroke={C.main} strokeWidth="1.8" />
      <path d="M45 59h18M54 50c-4 5-4 13 0 18M54 50c4 5 4 13 0 18" stroke={C.main} strokeWidth="1.3" fill="none" />
      <rect x="72" y="55" width="76" height="8" rx="4" fill={C.line} />
      <text x="156" y="64" fontSize="14" fontWeight="600" fill={C.ink} fontFamily="inherit">.com</text>
      <path d="m186 72 12 28 5-11 11-5z" fill={C.main} stroke={C.card} strokeWidth="1.5" strokeLinejoin="round" />
    </Scene>
  );
}

/** Envelope with a check. */
export function EmailArt() {
  return (
    <Scene>
      <rect x="58" y="30" width="124" height="72" rx="9" fill={C.card} stroke={C.line} strokeWidth="1.5" />
      <path d="m62 38 58 38 58-38" stroke={C.main} {...stroke} strokeWidth="3" />
      <rect x="76" y="86" width="36" height="5" rx="2.5" fill={C.line} /><rect x="120" y="86" width="22" height="5" rx="2.5" fill={C.line} />
      <circle cx="176" cy="34" r="16" fill={C.ok} /><path d="m168 34 6 6 11-12" stroke={C.card} {...stroke} strokeWidth="3" />
    </Scene>
  );
}

/** Open box with a product tag. */
export function ProductArt() {
  return (
    <Scene>
      <path d="M62 48 120 30l58 18v42l-58 18-58-18z" fill={C.card} stroke={C.line} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M62 48l58 18 58-18M120 66v42" stroke={C.main} {...stroke} strokeWidth="1.8" />
      <path d="M92 39l58 18v13l-14 5V62L78 44z" fill={C.sub} stroke={C.main} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="184" cy="30" r="14" fill={C.warm} /><path d="M178 30h12M184 24v12" stroke={C.card} {...stroke} strokeWidth="2.5" />
    </Scene>
  );
}

/** Paint palette with brush. */
export function ThemeArt() {
  return (
    <Scene>
      <path d="M118 20c-34 0-60 22-60 46s22 40 44 40c10 0 12-8 8-14-4-7 0-14 8-14h14c20 0 32-8 32-24 0-20-18-34-46-34z" fill={C.card} stroke={C.line} strokeWidth="1.8" />
      <circle cx="90" cy="52" r="8" fill={C.main} /><circle cx="116" cy="40" r="8" fill={C.warm} /><circle cx="144" cy="46" r="8" fill={C.ok} /><circle cx="82" cy="78" r="8" fill={C.sub} stroke={C.main} strokeWidth="1.5" />
      <path d="M176 26 150 78" stroke={C.soft} {...stroke} strokeWidth="5" /><path d="M150 78c-6 0-10 4-9 10 6 1 12-2 14-8z" fill={C.main} />
    </Scene>
  );
}

/** Delivery truck with speed lines. */
export function ShippingArt() {
  return (
    <Scene>
      <rect x="54" y="38" width="86" height="52" rx="6" fill={C.card} stroke={C.line} strokeWidth="1.5" />
      <path d="M140 52h24l16 18v20h-40z" fill={C.sub} stroke={C.main} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M150 58h12l8 10h-20z" fill={C.card} />
      <rect x="66" y="50" width="26" height="22" rx="3" fill={C.main} opacity=".85" /><path d="M66 61h26M79 50v22" stroke={C.card} strokeWidth="1.5" />
      <circle cx="82" cy="94" r="10" fill={C.ink} /><circle cx="82" cy="94" r="4" fill={C.card} /><circle cx="158" cy="94" r="10" fill={C.ink} /><circle cx="158" cy="94" r="4" fill={C.card} />
      <path d="M22 52h22M14 64h30M26 76h18" stroke={C.line} {...stroke} />
    </Scene>
  );
}

/** Cloud with a shield. */
export function BackupArt() {
  return (
    <Scene>
      <path d="M72 94c-16 0-26-9-26-22s10-21 24-22c3-14 15-24 31-24 17 0 29 10 32 25 14 1 24 10 24 22 0 12-10 21-24 21z" fill={C.card} stroke={C.line} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M120 48l22 8v14c0 14-9 22-22 27-13-5-22-13-22-27V56z" fill={C.main} />
      <path d="m110 72 7 7 14-15" stroke={C.card} {...stroke} strokeWidth="3" />
    </Scene>
  );
}

export const GUIDE_ART = { launch: LaunchArt, payments: PaymentsArt, domain: DomainArt, email: EmailArt, product: ProductArt, theme: ThemeArt, shipping: ShippingArt, backup: BackupArt } as const;
