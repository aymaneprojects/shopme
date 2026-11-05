import { Boxes } from 'lucide-react';
import { Outlet, useLocation } from 'react-router';
import { ContentTabs, CONTENT_SECTIONS } from '../components/ContentTabs';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../i18n';

/**
 * Layout of the Content sections that reuse the Online store pages (Files, Menus, Blog posts): the section tabs and a header whose action
 * slot (`store-header-actions`) receives each page's buttons. Detail pages (a menu, a post) bring their own header.
 */
export function ContentLayout() {
  const t = useT();
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const detail = segments.length >= 3;
  const active = CONTENT_SECTIONS.find((x) => pathname.startsWith(x.to));
  return (
    <>
      {!detail && (
        <>
          <PageHeader icon={<Boxes className="size-4" />} title={t(active?.key ?? 'nav.content')} actions={<span id="store-header-actions" className="contents" />} />
          <ContentTabs />
        </>
      )}
      <Outlet />
    </>
  );
}
