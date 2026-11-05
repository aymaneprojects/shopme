import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'critical' | 'critical-outline' | 'success' | 'plain' | 'plain-critical';
const variantCls: Record<Variant, string> = {
  primary: 'btn-primary', secondary: 'btn-secondary', danger: 'btn-critical', critical: 'btn-critical', plain: 'btn-plain', 'plain-critical': 'btn-plain-critical', 'critical-outline': 'btn-critical-outline', success: 'btn-success',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** Square, icon-only button; pass an `aria-label`. */
  icon?: boolean;
}

/** Tactile button. Loading swaps the label for a spinner without changing the width. */
export function Button({ variant = 'secondary', size = 'md', loading, icon, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type} disabled={disabled || loading} data-loading={loading ? 'true' : undefined} aria-busy={loading || undefined}
      className={cx('btn', variantCls[variant], size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', icon && 'btn-icon', className)}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden><Loader2 className="size-4 animate-spin" /></span>}
      <span className="btn-label inline-flex items-center gap-1">{children}</span>
    </button>
  );
}

/** Joins buttons into a segmented control. Mark the active one with `aria-pressed`. */
export function ButtonGroup({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cx('btn-group', className)} {...rest}>{children}</div>;
}

const badgeTones = {
  neutral: 'bg-[color-mix(in_srgb,var(--color-border)_70%,var(--color-bg))] text-fg',
  success: 'bg-success-subtle text-success',
  attention: 'bg-attention-subtle text-attention',
  warning: 'bg-warning-subtle text-warning',
  critical: 'bg-critical-subtle text-critical',
  info: 'bg-info-subtle text-info',
};
/** Status pill. `dot` adds a progress dot: hollow (none), half, or filled. */
export function Badge({ tone = 'neutral', dot, children }: { tone?: keyof typeof badgeTones; dot?: 'none' | 'half' | 'full' | boolean; children: ReactNode }) {
  const fill = dot === true ? 'full' : dot || undefined;
  return (
    <span className={cx('badge', badgeTones[tone])} data-fill={fill === 'none' ? undefined : fill}>
      {fill && <span className="badge-dot" aria-hidden />}
      {children}
    </span>
  );
}

/** Card: 12px radius, 16px padding. Use `CardSection` for divided blocks inside. */
export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg bg-canvas p-4 shadow-card', className)}>
      {(title || actions) && (
        <header className="mb-3 flex min-h-7 items-center justify-between gap-2">
          {title && <h2 className="text-[13px] font-semibold leading-5">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function CardSection({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('-mx-4 border-t border-line px-4 pt-4 first:border-t-0 first:pt-0 [&:not(:last-child)]:pb-4', className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton', className ?? 'h-4 w-full')} />;
}

export function EmptyState({ icon, image, title, description, action }: { icon?: ReactNode; image?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {image
        ? <img src={image} alt="" aria-hidden="true" width={160} height={160} className="size-40 object-contain" />
        : icon && <div className="grid size-12 place-items-center rounded-full bg-surface text-muted [&_svg]:size-6">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-[13px] text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Banner({ tone = 'critical', children, ...rest }: { tone?: 'critical' | 'warning' | 'info' | 'success' } & HTMLAttributes<HTMLDivElement>) {
  const t = { critical: 'bg-critical-subtle text-critical', warning: 'bg-attention-subtle text-attention', info: 'bg-info-subtle text-info', success: 'bg-success-subtle text-success' }[tone];
  return <div role={tone === 'critical' ? 'alert' : 'status'} className={cx('rounded-lg px-3 py-2 text-[13px]', t)} {...rest}>{children}</div>;
}

export function Spinner() {
  return <Loader2 className="size-5 animate-spin text-muted" aria-label="Loading" />;
}
