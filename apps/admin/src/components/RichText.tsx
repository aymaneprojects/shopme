import { Button, Modal, RichTextEditor, useToast, uploadFile } from '@shopme/ui';
import type { RichTextLabels } from '@shopme/ui';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { gql } from '../api';
import { PICKER_IMAGES } from '../graphql';
import { useI18n } from '../i18n';
import type { Key } from '../i18n';
import { useDebounced } from '../lib/hooks';

type Pick = { url: string; alt?: string | null };

/** Library of uploaded images to choose from (and upload to). */
function ImagePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: Pick) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const term = useDebounced(search).trim();
  const q = useQuery({
    queryKey: ['picker-images', term], enabled: open,
    queryFn: async () => (await gql<{ files: { nodes: { id: string; alt: string | null; image?: { url: string } | null }[] } }>(PICKER_IMAGES, { first: 40, query: ['media_type:IMAGE', term].filter(Boolean).join(' ') })).files.nodes.filter((n) => n.image?.url),
  });
  const upload = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    try { const up = await uploadFile(f); onPick({ url: up.url, alt: '' }); } catch (e) { toast((e as Error).message, 'critical'); }
    if (input.current) input.current.value = '';
  };
  return (
    <Modal open={open} onClose={onClose} closeLabel={t('common.close')} title={t('picker.image')} wide
      footer={<><Button onClick={() => input.current?.click()}><ImagePlus className="size-4" />{t('picker.imageUpload')}</Button><span className="flex-1" /><Button onClick={onClose}>{t('common.cancel')}</Button></>}>
      <input ref={input} type="file" accept="image/*" hidden aria-label={t('picker.imageUpload')} onChange={(e) => void upload(e.target.files)} />
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('picker.imageSearch')} aria-label={t('picker.imageSearch')} className="field-control mb-3 w-full" />
      {q.data?.length === 0 && <p className="py-6 text-center text-[13px] text-muted">{t('picker.imageEmpty')}</p>}
      <ul className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        {(q.data ?? []).map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick({ url: f.image!.url, alt: f.alt })} className="block aspect-square w-full overflow-hidden rounded-md border border-line hover:ring-2 hover:ring-primary">
              <img src={f.image!.url} alt={f.alt ?? ''} className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const LABELS: Array<[keyof RichTextLabels, string]> = [
  ['bold', 'rte.bold'], ['italic', 'rte.italic'], ['underline', 'rte.underline'], ['list', 'rte.list'], ['orderedList', 'rte.orderedList'], ['link', 'rte.link'], ['source', 'rte.showHtml'],
  ['paragraph', 'rte.paragraph'], ['heading', 'rte.heading'], ['subheading', 'rte.subheading'], ['linkPrompt', 'rte.linkPrompt'], ['heading1', 'rte.heading1'], ['heading2', 'rte.heading2'],
  ['heading3', 'rte.heading3'], ['heading4', 'rte.heading4'], ['quote', 'rte.quote'], ['color', 'rte.color'], ['customColor', 'rte.customColor'], ['defaultColor', 'rte.defaultColor'],
  ['alignLeft', 'rte.alignLeft'], ['alignCenter', 'rte.alignCenter'], ['alignRight', 'rte.alignRight'], ['justify', 'rte.justify'], ['indent', 'rte.indent'], ['outdent', 'rte.outdent'],
  ['unlink', 'rte.unlink'], ['image', 'rte.image'], ['imageUpload', 'rte.imageUpload'], ['video', 'rte.video'], ['videoPrompt', 'rte.videoPrompt'], ['videoInvalid', 'rte.videoInvalid'],
  ['table', 'rte.table'], ['tableRows', 'rte.tableRows'], ['tableColumns', 'rte.tableColumns'], ['clearFormat', 'rte.clearFormat'], ['apply', 'rte.apply'], ['insert', 'rte.insert'],
  ['cancel', 'rte.cancel'], ['editor', 'rte.editor'],
];

/** The rich-text editor wired to translations and the admin image library. Used for product, collection, page and article content. */
export function RichText({ value, onChange, id }: { value: string; onChange: (html: string) => void; id?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [picker, setPicker] = useState<((p: Pick) => void) | null>(null);
  const labels = Object.fromEntries(LABELS.map(([k, key]) => [k, t(key as Key)])) as unknown as RichTextLabels;
  return (
    <>
      <RichTextEditor id={id} value={value} onChange={onChange} labels={labels} onError={(m) => toast(m, 'critical')} onPickImage={(insert) => setPicker(() => insert)} />
      <ImagePicker open={!!picker} onClose={() => setPicker(null)} onPick={(p) => { picker?.(p); setPicker(null); }} />
    </>
  );
}
