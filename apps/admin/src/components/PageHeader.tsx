import { Dropdown } from '@shopme/ui';
import type { MenuItem } from '@shopme/ui';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n';

/** Page title row: back arrow, title, status badges, then secondary/primary actions and an optional "More actions" menu. */
export function PageHeader({ title, back, actions, badges, more, subtitle }: { title: ReactNode; back?: string; actions?: ReactNode; badges?: ReactNode; more?: MenuItem[]; subtitle?: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2">
      {back && (
        <Link to={back} aria-label={t('common.back')} className="btn btn-secondary btn-icon btn-sm"><ArrowLeft className="size-4" /></Link>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-semibold leading-7">{title}</h1>
          {badges}
        </div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {actions}
        {more && more.length > 0 && <Dropdown align="right" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={more} />}
      </div>
    </div>
  );
}
