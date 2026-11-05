import { cx } from '@shopme/ui';
import { NavLink } from 'react-router';
import { useT } from '../i18n';
import type { Key } from '../i18n';

/** The sections of Content: metaobjects, files, menus and blog posts. */
export const CONTENT_SECTIONS: Array<{ to: string; key: Key }> = [
  { to: '/content/metaobjects', key: 'nav.metaobjects' }, { to: '/content/files', key: 'store.files' },
  { to: '/content/navigation', key: 'store.navigation' }, { to: '/content/blog-posts', key: 'store.blogPosts' },
];

/** Tab strip shared by the Content pages (the sidebar lists Content as one entry). */
export function ContentTabs() {
  const t = useT();
  return (
    <nav aria-label={t('nav.content')} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {CONTENT_SECTIONS.map((x) => (
        <NavLink key={x.to} to={x.to} className={({ isActive }) => cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium', isActive ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg')}>{t(x.key)}</NavLink>
      ))}
    </nav>
  );
}
