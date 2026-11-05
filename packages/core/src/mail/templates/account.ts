import type { Mail } from '../../mail';
import type { Shop } from '../../services/shops';

type Dict = Record<string, string>;
const STRINGS: Record<string, Dict> = {
  en: {
    resetSubject: 'Reset your password', resetIntro: 'We received a request to reset the password of your {shop} account.', resetAction: 'Reset password',
    resetIgnore: 'If you did not ask for this, you can ignore this email: your password stays the same. The link expires in 24 hours.',
    activateSubject: 'Activate your account', activateIntro: 'Create a password to activate your {shop} account.', activateAction: 'Activate account', activateIgnore: 'The link expires in 7 days.',
    contactSubject: '[{shop}] New message from {name}', contactIntro: 'New message sent through the contact form.', from: 'From', phone: 'Phone', message: 'Message',
  },
  fr: {
    resetSubject: 'Réinitialisez votre mot de passe', resetIntro: 'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte {shop}.', resetAction: 'Réinitialiser le mot de passe',
    resetIgnore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé. Le lien expire dans 24 heures.",
    activateSubject: 'Activez votre compte', activateIntro: 'Créez un mot de passe pour activer votre compte {shop}.', activateAction: 'Activer le compte', activateIgnore: 'Le lien expire dans 7 jours.',
    contactSubject: '[{shop}] Nouveau message de {name}', contactIntro: 'Nouveau message envoyé via le formulaire de contact.', from: 'De', phone: 'Téléphone', message: 'Message',
  },
};

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dict = (locale: string) => { const d = STRINGS[locale.slice(0, 2).toLowerCase()] ?? STRINGS.en!; return (k: string, v: Record<string, string> = {}) => (d[k] ?? STRINGS.en![k] ?? k).replace(/\{(\w+)\}/g, (_m, n: string) => v[n] ?? ''); };

function layout(shop: Shop, intro: string, action: { label: string; url: string } | null, footer: string): { text: string; html: string } {
  const text = [intro, '', action ? `${action.label}: ${action.url}` : '', '', footer].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:24px">`
    + `<div style="background:#1E40AF;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;font-size:20px;font-weight:bold">${esc(shop.name)}</div>`
    + `<div style="background:#fff;padding:24px;border-radius:0 0 8px 8px"><p style="margin-top:0">${esc(intro)}</p>`
    + (action ? `<p><a href="${esc(action.url)}" style="display:inline-block;background:#1E40AF;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px">${esc(action.label)}</a></p>` : '')
    + `<p style="color:#64748b;font-size:13px">${esc(footer)}</p></div></div></body></html>`;
  return { text, html };
}

export function renderPasswordReset(shop: Shop, to: string, url: string): Mail {
  const t = dict(shop.locale);
  return { to, subject: t('resetSubject'), ...layout(shop, t('resetIntro', { shop: shop.name }), { label: t('resetAction'), url }, t('resetIgnore')) };
}

export function renderAccountActivation(shop: Shop, to: string, url: string): Mail {
  const t = dict(shop.locale);
  return { to, subject: t('activateSubject'), ...layout(shop, t('activateIntro', { shop: shop.name }), { label: t('activateAction'), url }, t('activateIgnore')) };
}

/** Contact form submission, addressed to the shop owner; the sender is the Reply-To. */
export function renderContactMessage(shop: Shop, f: { name?: string; email: string; phone?: string; body: string; extra?: Record<string, string> }): Mail & { replyTo: string } {
  const t = dict(shop.locale);
  const rows: [string, string][] = [[t('from'), `${f.name ? `${f.name} ` : ''}<${f.email}>`], ...(f.phone ? [[t('phone'), f.phone] as [string, string]] : []), ...Object.entries(f.extra ?? {})];
  const text = [t('contactIntro'), '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `${t('message')}:`, f.body].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a"><p>${esc(t('contactIntro'))}</p>`
    + `<table>${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
    + `<h3 style="font-size:15px">${esc(t('message'))}</h3><p style="white-space:pre-wrap">${esc(f.body)}</p></body></html>`;
  return { to: shop.email, replyTo: f.email, subject: t('contactSubject', { shop: shop.name, name: f.name || f.email }), text, html };
}
