import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'plain';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-line bg-canvas text-fg hover:bg-surface',
  danger: 'bg-critical text-on-primary hover:opacity-90',
  plain: 'text-primary hover:bg-primary-subtle',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const badgeTones = {
  neutral: 'bg-surface text-muted border border-line',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  critical: 'bg-critical-subtle text-critical',
  info: 'bg-primary-subtle text-primary',
};
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', badgeTones[tone])}>{children}</span>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-canvas p-4 shadow-sm', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-line', className ?? 'h-4 w-full')} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Banner({ tone = 'critical', children, ...rest }: { tone?: 'critical' | 'warning' | 'info' | 'success' } & HTMLAttributes<HTMLDivElement>) {
  const t = { critical: 'bg-critical-subtle text-critical', warning: 'bg-warning-subtle text-warning', info: 'bg-primary-subtle text-primary', success: 'bg-success-subtle text-success' }[tone];
  return <div role={tone === 'critical' ? 'alert' : 'status'} className={cx('rounded-md px-3 py-2 text-sm', t)} {...rest}>{children}</div>;
}

export function Spinner() {
  return <Loader2 className="size-5 animate-spin text-muted" aria-label="Loading" />;
}
