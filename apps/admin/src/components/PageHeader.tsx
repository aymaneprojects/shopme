import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n';

export function PageHeader({ title, back, actions }: { title: ReactNode; back?: string; actions?: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {back && <Link to={back} aria-label={t('common.back')} className="rounded p-1.5 hover:bg-surface"><ArrowLeft className="size-5" /></Link>}
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
