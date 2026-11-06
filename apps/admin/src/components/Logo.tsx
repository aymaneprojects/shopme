/** Original ShopMe S-ribbon. Kept in sync with public/shopme-mark.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#173b32" />
      <path d="M22 8h-9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8h-9" fill="none" stroke="#b4efd3" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
