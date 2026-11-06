import { Dropdown } from '@shopme/ui';
import { Eye } from 'lucide-react';
import { useT } from '../i18n';
import { useStorefrontUrl } from '../lib/storefront-url';

/** "View as" menu: opens the storefront (or a given storefront page) as a visitor on a computer or a phone. */
export function ViewAs({ url: given }: { url?: string | null }) {
  const t = useT();
  const storefront = useStorefrontUrl();
  const url = given === undefined ? storefront('/') : given;
  return (
    <Dropdown align="right" trigger={<><Eye className="size-4" />{t('viewAs.label')}</>} items={[
      { key: 'desktop', label: t('viewAs.desktop'), disabled: !url, onSelect: () => { window.open(url ?? '/', '_blank', 'noopener'); } },
      { key: 'mobile', label: t('viewAs.mobile'), disabled: !url, onSelect: () => { window.open(url ?? '/', '_blank', 'popup,width=390,height=844'); } },
    ]} />
  );
}
