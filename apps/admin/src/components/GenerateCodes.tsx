import { Button, Card, Input, Modal, Select, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { UserErrors, gql, mutate } from '../api';
import { DISCOUNT_CODES_GENERATE, DISCOUNT_CODES_PAGE } from '../graphql';
import { useT } from '../i18n';
import type { Key } from '../i18n';
import { downloadText, toCsv } from '../lib/download';

const SETS = ['ALPHANUMERIC', 'LETTERS', 'DIGITS', 'UNAMBIGUOUS'] as const;
type CharacterSet = (typeof SETS)[number];
const ALPHABET: Record<CharacterSet, string> = { ALPHANUMERIC: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', LETTERS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', DIGITS: '0123456789', UNAMBIGUOUS: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' };

interface CodesPage { codeDiscountNode: { codeDiscount: { codesCount: { count: number } | null; codes: { nodes: { code: string; asyncUsageCount: number }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } | null }

/** Preview of what the generator will produce (the server draws the real, unique codes). */
export function sampleCode(length: number, prefix: string, suffix: string, set: CharacterSet): string {
  const chars = ALPHABET[set];
  const body = Array.from({ length: Math.max(0, length) }, (_, i) => chars[(i * 7 + 3) % chars.length]).join('');
  return `${prefix}${body}${suffix}`.toUpperCase();
}

/** "Codes" card of a saved code discount: how many codes it has, "Generate codes" and a CSV export. */
export function GenerateCodesCard({ discountId }: { discountId: string }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('100');
  const [length, setLength] = useState('8');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [set, setSet] = useState<CharacterSet>('ALPHANUMERIC');
  const [exporting, setExporting] = useState(false);

  const info = useQuery({ queryKey: ['discount-codes', discountId], queryFn: () => gql<CodesPage>(DISCOUNT_CODES_PAGE, { id: discountId, first: 1 }) });
  const total = info.data?.codeDiscountNode?.codeDiscount.codesCount?.count ?? 0;

  const run = useMutation({
    mutationFn: () => mutate<{ bulkCreation: { importedCount: number } | null }>(DISCOUNT_CODES_GENERATE, {
      discountId, count: Number(count), length: Number(length), prefix: prefix || null, suffix: suffix || null, characterSet: set,
    }, 'shopmeDiscountCodesGenerate'),
    onSuccess: (r) => {
      setOpen(false);
      toast(t('discountCodes.generated', { n: r.bulkCreation?.importedCount ?? 0 }));
      void qc.invalidateQueries({ queryKey: ['discount-codes', discountId] });
      void qc.invalidateQueries({ queryKey: ['discount'] });
    },
    onError: (e) => toast(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' ') : e.message, 'critical'),
  });

  const exportCodes = async () => {
    setExporting(true);
    try {
      const rows: unknown[][] = [['Code', 'Used']];
      for (let after: string | null = null; ;) {
        const r: CodesPage = await gql<CodesPage>(DISCOUNT_CODES_PAGE, { id: discountId, first: 250, after });
        const page = r.codeDiscountNode?.codeDiscount.codes;
        if (!page) break;
        for (const c of page.nodes) rows.push([c.code, c.asyncUsageCount]);
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      downloadText('discount-codes.csv', toCsv(rows));
    } catch (e) { toast(e instanceof Error ? e.message : t('discountCodes.exportFailed'), 'critical'); } finally { setExporting(false); }
  };

  const valid = Number(count) >= 1 && Number(count) <= 10000 && Number(length) >= 4 && Number(length) <= 32;
  return (
    <Card title={t('discountCodes.title')}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px]">{t('discountCodes.count', { n: total })}</p>
        <p className="text-xs text-muted">{t('discountCodes.help')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen(true)}><Sparkles className="size-4" />{t('discountCodes.generate')}</Button>
          <Button loading={exporting} onClick={() => void exportCodes()}><Download className="size-4" />{t('discountCodes.export')}</Button>
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t('discountCodes.dialogTitle')} closeLabel={t('common.close')}
        footer={<><Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!valid} loading={run.isPending} onClick={() => run.mutate()}>{t('discountCodes.run')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('discountCodes.number')} type="number" min={1} max={10000} value={count} onChange={(e) => setCount(e.target.value)} />
          <Input label={t('discountCodes.length')} type="number" min={4} max={32} value={length} onChange={(e) => setLength(e.target.value)} />
          <Input label={t('discountCodes.prefix')} help={t('discountCodes.prefixHelp')} value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
          <Input label={t('discountCodes.suffix')} value={suffix} onChange={(e) => setSuffix(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
          <div className="sm:col-span-2">
            <Select label={t('discountCodes.characters')} value={set} onChange={(e) => setSet(e.target.value as CharacterSet)}>
              {SETS.map((s) => <option key={s} value={s}>{t(`discountCodes.chars.${s}` as Key)}</option>)}
            </Select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">{t('discountCodes.example', { code: sampleCode(Number(length) || 0, prefix, suffix, set) })}</p>
      </Modal>
    </Card>
  );
}
