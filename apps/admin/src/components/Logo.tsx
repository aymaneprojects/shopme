/** Original ShopMe ribbon mark. Kept in sync with public/shopme-mark.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#173b32" />
      <path d="M23 8H13a6 6 0 0 0 0 12h5a2 2 0 0 1 0 4H9v-4h9a2 2 0 0 0 0-4h-5a2 2 0 0 1 0-4h10Z" fill="#b4efd3" />
      <path d="m20 5 6 5-6 5V5Z" fill="#b4efd3" />
    </svg>
  );
}
