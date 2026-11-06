import { Badge, Banner, Button, ConfirmDialog, Input, Select, Skeleton, Switch, cx, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, CreditCard, FileText, Image as ImageIcon, Info, LayoutTemplate, Link2, Monitor, MousePointerClick, PanelsTopLeft, Redo2, Settings, ShoppingCart, SquareDashed, Smartphone, Tag, Truck, Undo2, UserRound, LogOut, ReceiptText, ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { UserErrors, apiUrl, gql, mutate } from '../../api';
import { EditorPageMenu } from '../../components/EditorPageMenu';
import { ACCOUNT_PAGES_THEME, CHECKOUT_CONFIGURATION_UPDATE } from '../../graphql';
import { gidToNum } from '../../format';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { ACCOUNT_TEMPLATE, findBlock, historyReducer, isAccountPage, isEditorPage, startHistory, treeOf, type EditorPage, type History, type HistoryAction, type TreeNode } from '../../lib/checkout-editor';
import type { CheckoutConfig } from '../../lib/config';
import { ThemeEditorPage, type AccountsChrome } from '../online-store/ThemeEditor';
import { useConfigurations, type CheckoutConfiguration, type CheckoutForm } from './Checkout';

/** What the editor changes: the checkout rules, their tip presets as typed, and the checkout look. */
export interface Draft { settings: CheckoutForm; presets: string; config: CheckoutConfig }
type Rule = 'hidden' | 'optional' | 'required';

const reduce = (h: History<Draft>, a: HistoryAction<Draft>) => historyReducer(h, a);
export const draftOf = (c: Pick<CheckoutConfiguration, 'settings' | 'config'>): Draft => ({ settings: c.settings, presets: c.settings.tipping.presets.join(', '), config: c.config });

/** The values the server takes: tip presets parsed from the typed text (kept as they were while the text is not a list of whole numbers). */
export function payloadOf(d: Draft): { settings: CheckoutForm; config: CheckoutConfig } {
  const parsed = d.presets.split(/[,\s]+/).filter(Boolean).map(Number);
  const presets = parsed.every((n) => Number.isInteger(n)) ? parsed : d.settings.tipping.presets;
  return { settings: { ...d.settings, tipping: { ...d.settings.tipping, presets } }, config: d.config };
}

const ICONS: Record<TreeNode['icon'], LucideIcon> = { logo: ImageIcon, link: Link2, user: UserRound, truck: Truck, card: CreditCard, action: MousePointerClick, cart: ShoppingCart, tag: Tag, total: ReceiptText, policy: FileText, check: CircleCheck, info: Info, sub: SquareDashed };

/** The live theme's id, for the customer account pages (edited in the theme) and the link back to the theme editor. */
function useLiveTheme() {
  return useQuery({ queryKey: ['account-pages-theme'], queryFn: async () => (await gql<{ themes: { nodes: Array<{ id: string; role: string }> } }>(ACCOUNT_PAGES_THEME)).themes.nodes.find((n) => n.role === 'MAIN') ?? null });
}

/** Settings > Checkout > a configuration: one editor with a page selector (checkout, thank-you, customer accounts), a left panel and a live preview. */
export function CheckoutConfigurationPage() {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const asked = params.get('page');
  const page: EditorPage = isEditorPage(asked) ? asked : 'checkout';
  const q = useConfigurations();
  const live = useLiveTheme();
  const c = q.data?.find((x) => x.id === id);
  if (q.isLoading) return <div className="fixed inset-0 z-[45] grid gap-4 bg-page p-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  if (q.error) return <div className="p-4"><Banner>{q.error.message}</Banner></div>;
  if (!c) return <div className="p-4"><Banner>{t('ckeditor.notFound')}</Banner><Link to="/settings/checkout" className="mt-3 inline-block text-accent underline">{t('checkout.pageTitle')}</Link></div>;
  const onPage = (p: EditorPage) => setParams({ page: p }, { replace: true });
  const toTheme = () => (live.data ? nav(`/online-store/themes/${gidToNum(live.data.id)}/editor`) : nav('/online-store'));
  if (isAccountPage(page)) {
    if (live.isLoading) return <div className="fixed inset-0 z-[45] bg-page p-4"><Skeleton className="h-96" /></div>;
    if (!live.data) return <div className="p-4"><Banner>{t('acct.noTheme')}</Banner></div>;
    const accounts: AccountsChrome = {
      name: c.name, active: c.active, template: ACCOUNT_TEMPLATE[page]!, backTo: '/settings/checkout',
      menu: <EditorPageMenu current={page} onSelect={onPage} onTheme={toTheme} />,
    };
    return <ThemeEditorPage themeNum={gidToNum(live.data.id)} accounts={accounts} />;
  }
  return <CheckoutEditor key={c.id} config={c} page={page} onPage={onPage} onTheme={toTheme} />;
}

function CheckoutEditor({ config, page, onPage, onTheme }: { config: CheckoutConfiguration; page: EditorPage; onPage: (p: EditorPage) => void; onTheme: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [saved, setSaved] = useState(() => draftOf(config));
  const [hist, dispatch] = useReducer(reduce, undefined, () => startHistory(draftOf(config)));
  const draft = hist.present;
  const payload = useMemo(() => payloadOf(draft), [draft]);
  const dirty = JSON.stringify(payloadOf(draft)) !== JSON.stringify(payloadOf(saved));
  const [tab, setTab] = useState<'sections' | 'settings'>('sections');
  const [sel, setSel] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [error, setError] = useState<string | null>(null);
  const tree = treeOf(page);
  const block = sel ? findBlock(page, sel) : null;

  const edit = (next: Draft, tag?: string) => dispatch({ kind: 'set', value: next, tag, at: Date.now() });
  const setSettings = (p: Partial<CheckoutForm>, tag?: string) => edit({ ...draft, settings: { ...draft.settings, ...p } }, tag);
  const setBranding = (p: Partial<CheckoutConfig['branding']>, tag?: string) => edit({ ...draft, config: { ...draft.config, branding: { ...draft.config.branding, ...p } } }, tag);

  const save = useMutation({
    mutationFn: () => mutate(CHECKOUT_CONFIGURATION_UPDATE, { id: config.id, settings: payload.settings, config: payload.config }, 'shopmeCheckoutConfigurationUpdate'),
    onSuccess: () => {
      toast(t('settings.saved')); setError(null); setSaved(draft);
      void qc.invalidateQueries({ queryKey: ['checkout-configurations'] }); void qc.invalidateQueries({ queryKey: ['checkout-settings'] }); void qc.invalidateQueries({ queryKey: ['config', 'CHECKOUT'] });
    },
    onError: (e) => setError(e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : e.message),
  });

  // ---- preview: the server renders the page with sample data and the unsaved values
  const [doc, setDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const selectRef = useRef<string>('');
  const sig = JSON.stringify(payload);
  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl('/checkout-preview'), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ page, ...(JSON.parse(sig) as object), select: selectRef.current }) });
        if (!res.ok) throw new Error(String(res.status));
        setDoc(await res.text()); setFailed(false);
      } catch { if (!ctl.signal.aborted) setFailed(true); }
    }, doc === null ? 0 : 350);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [sig, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string | null) => {
    setSel(id);
    const name = id ? findBlock(page, id)?.preview ?? '' : '';
    selectRef.current = name;
    frame.current?.contentWindow?.postMessage({ shopmeSelect: name }, '*');
  };
  useEffect(() => { setSel(null); selectRef.current = ''; setDoc(null); }, [page]);
  // a click on a block of the preview picks the matching block of the left panel
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data.shopmeClick !== 'string') return;
      const flat = (list: TreeNode[]): Array<{ id: string; preview?: string }> => list.flatMap((n) => [{ id: n.id, preview: n.preview }, ...flat(n.children ?? [])]);
      const all = [...tree.flatMap((g) => flat(g.nodes)), ...tree.filter((g) => g.panel).map((g) => ({ id: g.panel!, preview: g.preview }))];
      const id = all.find((x) => x.preview === e.data.shopmeClick)?.id;
      if (id) { setTab('sections'); pick(id); }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault(); dispatch({ kind: e.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const topBtn = 'grid size-8 place-items-center rounded-md text-fg hover:bg-hover disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent aria-selected:bg-primary-subtle aria-selected:text-accent';
  const pageName = t(`ckeditor.page.${page}` as Key);

  // ---- panels
  const Radios = <T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<{ id: T; label: string; help?: string }>; onChange: (v: T) => void }) => (
    <div role="radiogroup" aria-label={name} className="flex flex-col gap-2.5">
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
          <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="mt-0.5 size-4 accent-[var(--color-primary,#1E40AF)]" />
          <span><span className="block font-medium">{o.label}</span>{o.help && <span className="block text-[12px] text-muted">{o.help}</span>}</span>
        </label>
      ))}
    </div>
  );
  const colorField = (label: string, key: 'accentColor' | 'backgroundColor', fallback: string) => (
    <div className="flex items-end gap-2">
      <Input className="flex-1" label={label} placeholder={fallback} value={draft.config.branding[key]} onChange={(e) => setBranding({ [key]: e.target.value.trim() }, `b:${key}`)} error={draft.config.branding[key] && !/^#[0-9a-fA-F]{6}$/.test(draft.config.branding[key]) ? t('bs.colorInvalid') : null} />
      <input type="color" aria-label={label} value={draft.config.branding[key] || fallback} onChange={(e) => setBranding({ [key]: e.target.value }, `b:${key}`)} className="h-10 w-12 cursor-pointer rounded-md border border-line bg-transparent p-1" />
    </div>
  );
  const rule = (label: string, key: 'company' | 'address2' | 'phone') => (
    <Select label={label} value={draft.settings[key]} onChange={(e) => setSettings({ [key]: e.target.value as Rule })}>
      <option value="hidden">{t('checkout.rule.hidden')}</option><option value="optional">{t('checkout.rule.optional')}</option><option value="required">{t('checkout.rule.required')}</option>
    </Select>
  );
  const note = (text: string, to?: string, linkLabel?: string) => <div className="flex flex-col gap-2 text-[13px] text-muted"><p>{text}</p>{to && <Link to={to} className="text-accent underline">{linkLabel}</Link>}</div>;
  const panel = (id: string): ReactNode => {
    switch (id) {
      case 'header': return <Input label={t('bs.headerText')} maxLength={160} value={draft.config.branding.headerText} onChange={(e) => setBranding({ headerText: e.target.value }, 'b:headerText')} />;
      case 'logo': return <Input label={t('bs.logoUrl')} help={t('bs.logoUrlHelp')} placeholder="https://" value={draft.config.branding.logoUrl} onChange={(e) => setBranding({ logoUrl: e.target.value.trim() }, 'b:logoUrl')} />;
      case 'contact': return (
        <div className="flex flex-col gap-4">
          <Radios name={t('checkout.accounts')} value={draft.settings.accountMode} onChange={(v) => setSettings({ accountMode: v })} options={[
            { id: 'guest', label: t('checkout.accounts.guest'), help: t('checkout.accounts.guestHelp') }, { id: 'required', label: t('checkout.accounts.required'), help: t('checkout.accounts.requiredHelp') },
          ]} />
          <Select label={t('checkout.marketing.label')} value={draft.settings.marketing} onChange={(e) => setSettings({ marketing: e.target.value as CheckoutForm['marketing'] })}>
            <option value="hidden">{t('checkout.marketing.hidden')}</option><option value="unchecked">{t('checkout.marketing.unchecked')}</option><option value="checked">{t('checkout.marketing.checked')}</option>
          </Select>
          {note(t('ckeditor.accountsNote'), '/settings/accounts', t('settings.accounts'))}
        </div>
      );
      case 'contactMethod': return (
        <Radios name={t('checkout.contact')} value={draft.settings.contactMethod} onChange={(v) => setSettings({ contactMethod: v })} options={[
          { id: 'email', label: t('checkout.contact.email') }, { id: 'email_or_phone', label: t('checkout.contact.emailOrPhone'), help: t('checkout.contact.emailOrPhoneHelp') },
        ]} />
      );
      case 'delivery': return (
        <Select label={t('checkout.info.name')} value={draft.settings.nameMode} onChange={(e) => setSettings({ nameMode: e.target.value as CheckoutForm['nameMode'] })}>
          <option value="full">{t('checkout.info.nameFull')}</option><option value="last">{t('checkout.info.nameLast')}</option>
        </Select>
      );
      case 'address': return (
        <div className="flex flex-col gap-4">
          {rule(t('checkout.info.company'), 'company')}{rule(t('checkout.info.address2'), 'address2')}{rule(t('checkout.info.phone'), 'phone')}
          <Switch placement="end" checked={draft.config.addressAutocomplete} onChange={(v) => edit({ ...draft, config: { ...draft.config, addressAutocomplete: v } })} label={t('bs.autofillEnable')} />
        </div>
      );
      case 'shippingMode': return (
        <div className="flex flex-col gap-4">
          <Switch placement="end" checked={draft.settings.orderNotes} onChange={(v) => setSettings({ orderNotes: v })} label={t('checkout.notes.enable')} />
          {note(t('ckeditor.shippingNote'), '/settings/shipping', t('ckeditor.openShipping'))}
        </div>
      );
      case 'shippingList': return note(t('ckeditor.shippingNote'), '/settings/shipping', t('ckeditor.openShipping'));
      case 'payment': case 'paymentOption': return note(t('ckeditor.paymentsNote'), '/settings/payments', t('ckeditor.openPayments'));
      case 'action': case 'payNow': return (
        <Select label={t('bs.buttonShape')} value={draft.config.branding.buttonShape} onChange={(e) => setBranding({ buttonShape: e.target.value as CheckoutConfig['branding']['buttonShape'] })}>
          <option value="pill">{t('bs.shape.pill')}</option><option value="rounded">{t('bs.shape.rounded')}</option><option value="square">{t('bs.shape.square')}</option>
        </Select>
      );
      case 'discount': case 'discountField': return note(t('ckeditor.discountNote'));
      case 'total': return (
        <div className="flex flex-col gap-3">
          <Switch placement="end" checked={draft.settings.tipping.enabled} onChange={(v) => setSettings({ tipping: { ...draft.settings.tipping, enabled: v } })} label={t('checkout.tipping.enable')} />
          {draft.settings.tipping.enabled && <Input label={t('checkout.tipping.presets')} help={t('checkout.tipping.presetsHelp')} value={draft.presets} inputMode="numeric" onChange={(e) => edit({ ...draft, presets: e.target.value }, 'presets')} />}
        </div>
      );
      case 'footer': return (
        <div className="flex flex-col gap-4">
          <Input label={t('bs.footerText')} maxLength={300} value={draft.config.branding.footerText} onChange={(e) => setBranding({ footerText: e.target.value }, 'b:footerText')} />
          {note(t('ckeditor.policiesNote'), '/settings/policies', t('ckeditor.openPolicies'))}
        </div>
      );
      case 'policies': return note(t('ckeditor.policiesNote'), '/settings/policies', t('ckeditor.openPolicies'));
      default: return <p className="text-[13px] text-muted">{t('ckeditor.noSettings')}</p>;
    }
  };

  const row = (n: TreeNode, depth: number): ReactNode => {
    const I = ICONS[n.icon];
    return (
      <li key={n.id}>
        <button type="button" aria-current={sel === n.id} onClick={() => pick(n.id)} style={{ paddingLeft: 12 + depth * 16 }} className={cx('flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[12.5px] hover:bg-hover', sel === n.id && 'bg-primary-subtle text-accent')}>
          <I className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{t(n.label)}</span>
        </button>
        {n.children && <ul>{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  const sections = (
    <div className="pb-4">
      {tree.map((g) => (
        <section key={g.id} aria-label={t(g.label)} className="border-b border-line py-2 last:border-b-0">
          {g.panel
            ? <button type="button" aria-current={sel === g.panel} onClick={() => pick(g.panel!)} className={cx('flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] font-semibold hover:bg-hover', sel === g.panel && 'bg-primary-subtle text-accent')}>{t(g.label)}<ChevronRight className="size-3.5" aria-hidden /></button>
            : <h2 className="px-3 py-1.5 text-[12px] font-semibold">{t(g.label)}</h2>}
          <ul>{g.nodes.map((n) => row(n, 0))}</ul>
        </section>
      ))}
    </div>
  );
  const settingsTab = (
    <div className="flex flex-col gap-4 p-3">
      <h2 className="text-[12px] font-semibold">{t('ckeditor.colors')}</h2>
      {colorField(t('bs.accentColor'), 'accentColor', '#1E40AF')}
      {colorField(t('bs.backgroundColor'), 'backgroundColor', '#ffffff')}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-page text-fg">
      <ConfirmDialog open={blocker.state === 'blocked'} title={t('save.leaveTitle')} message={t('save.leaveBody')} confirmLabel={t('save.leave')} cancelLabel={t('save.stay')} closeLabel={t('common.close')} danger onConfirm={() => blocker.proceed?.()} onClose={() => blocker.reset?.()} />
      <header className="relative flex h-[46px] shrink-0 items-center justify-between px-3">
        <div role="tablist" aria-label={t('editor.panels')} className="flex items-center gap-1">
          <button type="button" aria-label={t('common.back')} title={t('common.back')} className={topBtn} onClick={() => nav('/settings/checkout')}><LogOut className="size-4 -scale-x-100" /></button>
          <button type="button" role="tab" aria-selected={tab === 'sections'} aria-label={t('editor.tabSections')} title={t('editor.tabSections')} className={topBtn} onClick={() => setTab('sections')}><PanelsTopLeft className="size-4" /></button>
          <button type="button" role="tab" aria-selected={tab === 'settings'} aria-label={t('editor.tabSettings')} title={t('editor.tabSettings')} className={topBtn} onClick={() => setTab('settings')}><Settings className="size-4" /></button>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center gap-10 text-[12px]">
          <div className="pointer-events-auto flex items-center gap-2"><LayoutTemplate className="size-3.5" aria-hidden /><span className="max-w-[260px] truncate font-medium">{config.name}</span>{config.active ? <Badge tone="success">{t('ckeditor.active')}</Badge> : <Badge tone="info">{t('editor.draft')}</Badge>}</div>
          <EditorPageMenu current={page} onSelect={onPage} onTheme={onTheme} />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t(device === 'desktop' ? 'themes.mobile' : 'themes.desktop')} title={t(device === 'desktop' ? 'themes.mobile' : 'themes.desktop')} className={topBtn} onClick={() => setDevice(device === 'desktop' ? 'mobile' : 'desktop')}>{device === 'desktop' ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}</button>
          <button type="button" aria-label={t('editor.undo')} title={t('editor.undo')} disabled={!hist.past.length} onClick={() => dispatch({ kind: 'undo' })} className={topBtn}><Undo2 className="size-4" /></button>
          <button type="button" aria-label={t('editor.redo')} title={t('editor.redo')} disabled={!hist.future.length} onClick={() => dispatch({ kind: 'redo' })} className={topBtn}><Redo2 className="size-4" /></button>
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('save.save')}</Button>
        </div>
      </header>
      {error && <div className="px-1 pb-1"><Banner>{error}</Banner></div>}
      <div className="flex min-h-0 flex-1 gap-1 p-1 pt-0">
        <div className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-canvas">
          {tab === 'sections' && sel && block
            ? (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
                  <button type="button" aria-label={t('common.back')} title={t('common.back')} onClick={() => pick(null)} className="grid size-7 place-items-center rounded-md hover:bg-hover"><ArrowLeft className="size-4" /></button>
                  <h1 className="truncate text-[12px] font-semibold">{t(block.label)}</h1>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3" key={sel}>{panel(sel)}</div>
              </>
            )
            : (
              <>
                <h1 className="shrink-0 border-b border-line px-3 py-2 text-[12px] font-semibold">{tab === 'settings' ? t('editor.tabSettings') : pageName}</h1>
                <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'settings' ? settingsTab : sections}</div>
              </>
            )}
        </div>
        <div className="grid min-w-0 flex-1 place-items-stretch overflow-hidden rounded-lg border border-line bg-surface">
          {failed && <div className="p-2"><Banner>{t('ckeditor.previewFailed')}</Banner></div>}
          {doc === null && !failed ? <Skeleton className="m-3 h-[90%]" /> : doc !== null && (
            <div className={cx('h-full overflow-hidden', device === 'mobile' && 'mx-auto w-[390px] max-w-full border-x border-line')}>
              <iframe ref={frame} title={t('ckeditor.previewTitle', { page: pageName })} sandbox="allow-scripts" srcDoc={doc} className="h-full w-full bg-white" data-page={page} onLoad={() => frame.current?.contentWindow?.postMessage({ shopmeSelect: selectRef.current }, '*')} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
