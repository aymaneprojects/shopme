import { useI18n } from '../i18n';

/** Neutral text marks (outlined labels drawn as inline SVG): no third-party brand artwork is bundled. */
export function Mark({ label }: { label: string }) {
  const w = Math.max(40, Math.round(label.length * 6.6 + 18));
  return (
    <svg role="img" aria-label={label} width={w} height={24} viewBox={`0 0 ${w} 24`} className="shrink-0 text-fg">
      <rect x="0.5" y="0.5" width={w - 1} height="23" rx="4.5" fill="var(--color-canvas, #fff)" stroke="currentColor" strokeOpacity="0.25" />
      <text x={w / 2} y="16" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" fontFamily="inherit">{label}</text>
    </svg>
  );
}

export const CARD_BRAND_LABELS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay', cartes_bancaires: 'CB' };

/** Row of the payment methods shoppers can use: the card brands enabled through Stripe and the manual and redirect methods. */
export function PaymentLogos({ stripe, brands, methods }: { stripe: boolean; brands: string[]; methods: string[] }) {
  const { t } = useI18n();
  const marks = [...(stripe ? brands.map((b) => CARD_BRAND_LABELS[b] ?? b) : []), ...methods];
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t('pay.logos.title')}>
      {marks.length === 0 ? <p className="text-[13px] text-muted">{t('pay.logos.none')}</p> : marks.map((m, i) => <Mark key={`${m}-${i}`} label={m} />)}
    </div>
  );
}
