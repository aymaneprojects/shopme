import { Dropdown } from '@shopme/ui';
import type { MenuItem } from '@shopme/ui';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useT } from '../i18n';
import { NAV } from './Shell';

/** Top-level lists show their section icon; nested lists retain a back link to their parent section. */
function indexPage(pathname: string): { to?: string; icon: ReactNode } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  for (const item of NAV) {
    if (item.id === 'home' || item.id === 'settings') continue;
    if (item.to === path) return { icon: <item.icon className="size-4" /> };
    const child = item.children?.find((c) => c.to === path);
    if (child) return { to: item.to, icon: <item.icon className="size-4" /> };
  }
  return null;
}

/** Page title row: back arrow, title, status badges, then secondary/primary actions and an optional "More actions" menu. */
export function PageHeader({ title, back, actions, badges, more, subtitle, icon, breadcrumb, large }: { /** Detail pages: breadcrumb row (back arrow, section icon, parent) above a large title. */ large?: boolean; /** Parent list shown before the title: `Products / Title`. */ breadcrumb?: { icon?: ReactNode; label: ReactNode; to: string }; /** Section icon shown before the title on index pages. */ icon?: ReactNode; title: ReactNode; back?: string; actions?: ReactNode; badges?: ReactNode; more?: MenuItem[]; subtitle?: ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const index = !back && !breadcrumb && !large ? indexPage(pathname) : null;
  back ??= index?.to;
  icon ??= index?.icon;
  if (large && breadcrumb) {
    return (
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={back ?? breadcrumb.to} aria-label={t('common.back')} className="btn btn-secondary btn-icon btn-sm"><ArrowLeft className="size-4" /></Link>
          <Link to={breadcrumb.to} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">{breadcrumb.icon}{breadcrumb.label}</Link>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            {actions}
            {more && more.length > 0 && <Dropdown align="right" chevron label={t('common.moreActions')} trigger={t('common.moreActions')} items={more} />}
          </div>
        </div>
        <div className="flex items-center gap-2"><h1 className="min-w-0 truncate text-xl font-semibold leading-8">{title}</h1>{badges}</div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2">
      {back && (
        <Link to={back} aria-label={t('common.back')} className="btn btn-secondary btn-icon btn-sm"><ArrowLeft className="size-4" /></Link>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {breadcrumb && <><Link to={breadcrumb.to} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">{breadcrumb.icon}{breadcrumb.label}</Link><span className="text-muted" aria-hidden>/</span></>}
          {icon && <span className="text-muted" aria-hidden>{icon}</span>}
          <h1 className="truncate text-base font-semibold leading-7">{title}</h1>
          {badges}
        </div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
        {actions}
        {more && more.length > 0 && <Dropdown align="right" chevron label={t('common.moreActions')} trigger={t('common.moreActions')} items={more} />}
      </div>
    </div>
  );
}
