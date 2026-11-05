import { cookieBannerOf, type Shop } from '@shopme/core';

/** Remembers the visitor's choice (`accepted` | `declined`). Set by the banner script, read here to skip the banner. */
export const CONSENT_COOKIE = 'shopme_consent';

const TEXT = {
  en: { message: 'We use cookies to improve your experience.', accept: 'Accept', decline: 'Decline', label: 'Cookie consent' },
  fr: { message: 'Nous utilisons des cookies pour améliorer votre expérience.', accept: 'Accepter', decline: 'Refuser', label: 'Consentement aux cookies' },
} as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Consent banner for the storefront, injected into every HTML page by the server (theme-agnostic).
 * Empty when the shop has the banner disabled or the visitor already chose. Text follows the shop locale unless the
 * merchant wrote a custom message. Styles and script are inline so it works with any theme.
 */
export function cookieBannerHtml(shop: Shop, visitorChoice?: string | null): string {
  const cfg = cookieBannerOf(shop);
  if (!cfg.enabled || visitorChoice) return '';
  const lang = shop.locale.slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en';
  const t = TEXT[lang];
  const custom = (shop.settings.cookieBanner as { message?: unknown } | undefined)?.message;
  const message = typeof custom === 'string' && custom.trim() ? cfg.message : t.message;
  return `<style>
#shopme-cookie-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;padding:1rem 1.25rem;background:#fff;color:#111;border-top:1px solid #d4d4d4;box-shadow:0 -2px 12px rgba(0,0,0,.12);font:15px/1.4 system-ui,-apple-system,sans-serif}
#shopme-cookie-banner[hidden]{display:none}
#shopme-cookie-banner p{margin:0;flex:1 1 320px}
#shopme-cookie-banner .shopme-cookie-actions{display:flex;gap:.5rem}
#shopme-cookie-banner button{font:inherit;padding:.5rem 1rem;border-radius:4px;border:1px solid #111;background:#fff;color:#111;cursor:pointer}
#shopme-cookie-banner button.shopme-cookie-accept{background:#111;color:#fff}
#shopme-cookie-banner button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
</style>
<div id="shopme-cookie-banner" role="region" aria-label="${esc(t.label)}" hidden>
<p>${esc(message)}</p>
<div class="shopme-cookie-actions">
<button type="button" data-consent="declined">${esc(t.decline)}</button>
<button type="button" class="shopme-cookie-accept" data-consent="accepted">${esc(t.accept)}</button>
</div>
</div>
<script>(function(){var n=${JSON.stringify(CONSENT_COOKIE)},el=document.getElementById('shopme-cookie-banner');if(!el)return;try{if(document.cookie.split('; ').some(function(c){return c.indexOf(n+'=')===0}))return;}catch(e){}el.hidden=false;el.addEventListener('click',function(ev){var v=ev.target&&ev.target.getAttribute&&ev.target.getAttribute('data-consent');if(!v)return;try{document.cookie=n+'='+v+'; path=/; max-age=15552000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');}catch(e){}el.hidden=true;});})();</script>`;
}

/** Inject the banner before `</body>` (or at the end when the layout has none). */
export function injectCookieBanner(html: string, banner: string): string {
  if (!banner) return html;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + banner : html.slice(0, i) + banner + html.slice(i);
}
