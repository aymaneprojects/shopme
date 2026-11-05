import { Tooltip } from '@shopme/ui';
import { Info } from 'lucide-react';

/** A column title with a small info icon that explains the column on hover or focus. */
export function HelpHeader({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip content={help}><span tabIndex={0} role="img" aria-label={help} className="inline-grid text-muted outline-none focus-visible:text-fg"><Info className="size-3.5" /></span></Tooltip>
    </span>
  );
}
