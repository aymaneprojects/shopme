import { Banner, Button, Card, Checkbox, Modal, Switch, useToast } from '@shopme/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { UserErrors, gql, mutate } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { STAFF_INVITE_SECURE, STAFF_ROLES } from '../../graphql';
import { useI18n } from '../../i18n';
import type { Key } from '../../i18n';
import { PERMISSIONS } from '../../lib/permissions';

interface CustomRole { id: string; name: string; description: string | null; permissions: string[]; members: number }
/** What the "Assign" picker chose: the administrator role, a custom role, or the staff role with hand-picked areas. */
type Choice = { kind: 'admin' } | { kind: 'role'; id: string } | { kind: 'staff'; permissions: string[] };

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const errText = (e: unknown) => (e instanceof UserErrors ? e.errors.map((x) => x.message).join(' · ') : (e as Error).message);

/** Chips input: several addresses at once (typed with comma, space or Enter, or pasted). */
export function EmailChips({ value, onChange, label, help, error, onError }: { value: string[]; onChange: (v: string[]) => void; label: string; help: string; error: string | null; onError: (m: string | null) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const take = (raw: string, final: boolean) => {
    const parts = raw.split(/[\s,;]+/).filter(Boolean);
    // While typing, the last fragment stays in the box until a separator or blur ends it.
    const rest = !final && !/[\s,;]$/.test(raw) ? parts.pop() ?? '' : '';
    const good = parts.filter((p) => EMAIL_RE.test(p));
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    onChange([...value, ...good.map((p) => p.toLowerCase()).filter((p, i, a) => !value.includes(p) && a.indexOf(p) === i)]);
    onError(bad.length ? t('users.add.invalid', { email: bad[0]! }) : null);
    setText(bad.length ? bad.join(' ') + (rest ? ` ${rest}` : '') : rest);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); take(text, true); }
    else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); take(`${text}${e.clipboardData.getData('text')} `, true); };
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium" htmlFor="add-users-emails">{label}</label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg bg-field px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--color-border)] focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent" onClick={() => input.current?.focus()}>
        {value.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full bg-hover py-0.5 pl-2.5 pr-1 text-[13px]">{e}
            <button type="button" className="grid size-5 place-items-center rounded-full hover:bg-pressed" aria-label={t('users.add.remove', { email: e })} onClick={() => onChange(value.filter((x) => x !== e))}><X className="size-3" /></button>
          </span>
        ))}
        <input id="add-users-emails" ref={input} className="min-w-[10rem] flex-1 bg-transparent py-1 text-[13px] outline-none" type="email" multiple autoComplete="off" value={text} aria-invalid={!!error}
          onChange={(e) => take(e.target.value, false)} onKeyDown={onKey} onPaste={onPaste} onBlur={() => text && take(text, true)} />
      </div>
      {error ? <p className="mt-1 text-[12px] text-critical" role="alert">{error}</p> : <p className="mt-1 text-[12px] text-muted">{help}</p>}
    </div>
  );
}

/** Settings > Users > Add users: addresses, the secure sign-in requirement and the role to assign. */
export function AddUsersPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const roles = useQuery({ queryKey: ['staff-roles'], queryFn: async () => (await gql<{ shopmeStaffRoles: CustomRole[] }>(STAFF_ROLES)).shopmeStaffRoles });
  const [emails, setEmails] = useState<string[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [secure, setSecure] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Choice>({ kind: 'staff', permissions: ['products', 'orders'] });
  const [result, setResult] = useState<string | null>(null);
  const customRoles = roles.data ?? [];
  const chosenRole = choice?.kind === 'role' ? customRoles.find((r) => r.id === choice.id) : undefined;
  const label = choice?.kind === 'admin' ? t('users.role.admin') : chosenRole ? chosenRole.name : choice?.kind === 'staff' ? `${t('users.role.staff')} (${t('users.areas', { n: choice.permissions.length })})` : null;

  const send = useMutation({
    mutationFn: async () => {
      const c: Choice = choice ?? { kind: 'staff', permissions: [] };
      const role = c.kind === 'admin' ? 'admin' : 'staff';
      const custom = c.kind === 'role' ? customRoles.find((r) => r.id === c.id) : undefined;
      const permissions = c.kind === 'admin' ? [...PERMISSIONS] : custom ? custom.permissions : c.kind === 'staff' ? c.permissions : [];
      const failed: string[] = [];
      let ok = 0;
      for (const email of emails) {
        try { await mutate(STAFF_INVITE_SECURE, { email, role, roleId: custom?.id ?? null, permissions, secure }, 'shopmeStaffInvite'); ok += 1; } catch (e) { failed.push(`${email} (${errText(e)})`); }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
      if (ok) toast(t('users.add.sent', { n: ok }));
      if (!failed.length) { nav('/settings/users'); return; }
      setEmails([]); setResult(t('users.add.failed', { list: failed.join(', ') }));
    },
    onError: (e) => setResult(errText(e)),
  });

  const pickChoice = (c: Choice) => setDraft(c);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader back="/settings/users" title={t('users.add.title')} />
      {result && <Banner>{result}</Banner>}
      <section aria-labelledby="add-users-info" className="flex flex-col gap-2">
        <h2 id="add-users-info" className="text-[14px] font-semibold">{t('users.add.info')}</h2>
        <Card>
          <div className="flex flex-col gap-3">
            <EmailChips value={emails} onChange={setEmails} label={t('users.add.emails')} help={t('users.add.emailsHelp')} error={emailError} onError={setEmailError} />
            <div className="flex justify-end"><Button variant="primary" loading={send.isPending} disabled={emails.length === 0} onClick={() => { setResult(null); send.mutate(); }}>{t('users.add.submit')}</Button></div>
          </div>
        </Card>
      </section>
      <section aria-labelledby="add-users-secure" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3"><h2 id="add-users-secure" className="text-[14px] font-semibold">{t('users.add.secure')}</h2><Switch checked={secure} onChange={setSecure} label={t('users.add.secure')} /></div>
        <Card><p className="text-[13px] leading-5 text-muted">{t('users.add.secureHelp')}</p></Card>
      </section>
      <section aria-labelledby="add-users-roles" className="flex flex-col gap-2">
        <div><h2 id="add-users-roles" className="text-[14px] font-semibold">{t('users.add.roles')}</h2><p className="text-[13px] text-muted">{t('users.add.rolesHelp')}</p></div>
        <button type="button" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-4 text-[13px] font-medium hover:bg-hover" onClick={() => { if (choice) setDraft(choice); setPicking(true); }}>
          {label ? <span>{label}</span> : <><Plus className="size-4" aria-hidden />{t('users.add.assign')}</>}
        </button>
      </section>
      <Modal open={picking} onClose={() => setPicking(false)} closeLabel={t('common.close')} title={t('users.add.pick')}
        footer={<><Button onClick={() => setPicking(false)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { setChoice(draft); setPicking(false); }}>{t('users.add.assign')}</Button></>}>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('users.add.roles')}</legend>
          {([['admin', t('users.role.admin'), t('users.adminHelp')]] as const).map(([k, name, help]) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-hover"><input type="radio" name="role" className="mt-1" checked={draft.kind === 'admin'} onChange={() => pickChoice({ kind: 'admin' })} /><span><span className="block text-[13px] font-medium">{name}</span><span className="block text-xs text-muted">{help}</span></span></label>
          ))}
          {customRoles.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-hover"><input type="radio" name="role" className="mt-1" checked={draft.kind === 'role' && draft.id === r.id} onChange={() => pickChoice({ kind: 'role', id: r.id })} /><span><span className="block text-[13px] font-medium">{r.name}</span>{r.description && <span className="block text-xs text-muted">{r.description}</span>}</span></label>
          ))}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-hover"><input type="radio" name="role" className="mt-1" checked={draft.kind === 'staff'} onChange={() => pickChoice({ kind: 'staff', permissions: draft.kind === 'staff' ? draft.permissions : ['products', 'orders'] })} /><span><span className="block text-[13px] font-medium">{t('users.role.staff')}</span><span className="block text-xs text-muted">{t('users.permissions')}</span></span></label>
          {draft.kind === 'staff' && (
            <div className="ml-6 flex flex-col gap-1.5">
              {PERMISSIONS.map((p) => <Checkbox key={p} label={t(`users.perm.${p}` as Key)} checked={draft.permissions.includes(p)} onChange={(e) => pickChoice({ kind: 'staff', permissions: e.target.checked ? [...draft.permissions, p] : draft.permissions.filter((x) => x !== p) })} />)}
            </div>
          )}
        </fieldset>
      </Modal>
    </div>
  );
}
