import { Badge, Button, Dropdown, useToast } from '@shopme/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router';
import { mutate } from '../../api';
import { gidToNum } from '../../format';
import { THEME_DUPLICATE, THEME_PUBLISH } from '../../graphql';
import { useT } from '../../i18n';
import type { Key } from '../../i18n';

/** Theme status, Publish and the "more" menu shown in the header of both theme editor tabs. */
export function ThemeToolbar({ themeId, name, role, dirty, previewUrl }: { themeId: string; name: string; role?: string; dirty: boolean; previewUrl: string }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const live = role === 'MAIN';
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['themes'] }); void qc.invalidateQueries({ queryKey: ['theme-settings'] }); };
  const publish = useMutation({
    mutationFn: () => mutate(THEME_PUBLISH, { id: themeId }, 'themePublish'),
    onSuccess: () => { toast(t('themes.published')); refresh(); },
    onError: (e) => toast(e.message, 'critical'),
  });
  const duplicate = useMutation({
    mutationFn: () => mutate<{ newTheme: { id: string } }>(THEME_DUPLICATE, { id: themeId, name: t('themes.copyOf', { name }) }, 'themeDuplicate'),
    onSuccess: (r) => { toast(t('themes.duplicated')); refresh(); nav(`/online-store/themes/${gidToNum(r.newTheme.id)}/editor`); },
    onError: (e) => toast(e.message, 'critical'),
  });
  return (
    <>
      {role && (live ? <Badge tone="success">{t('themes.live')}</Badge> : <Badge>{t(`themes.role.${role}` as Key)}</Badge>)}
      <Dropdown align="right" icon label={t('common.moreActions')} trigger={<MoreHorizontal className="size-4" />} items={[
        { key: 'preview', label: t('editor.openPreview'), onSelect: () => { window.open(previewUrl, '_blank', 'noopener'); } },
        { key: 'duplicate', label: t('themes.duplicate'), onSelect: () => duplicate.mutate() },
        { key: 'download', label: t('themes.download'), onSelect: () => { window.location.href = `/admin/api/themes/${gidToNum(themeId)}/download.zip`; } },
        { key: 'all', label: t('editor.allThemes'), onSelect: () => nav('/online-store') },
      ]} />
      <Button variant="primary" disabled={live || dirty} loading={publish.isPending} title={dirty ? t('editor.saveFirst') : undefined} onClick={() => publish.mutate()}>{t('themes.publish')}</Button>
    </>
  );
}
