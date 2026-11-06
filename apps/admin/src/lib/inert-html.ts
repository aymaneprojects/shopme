/**
 * Makes a page inert before it goes into a sandboxed frame (`sandbox=""`, no `allow-scripts`). The browser logs a console error for
 * every script such a frame refuses to run, so nothing that could run is left in: `<script>` elements of every type (classic, module,
 * importmap, JSON, unclosed), module preloads, inline `on*` handlers, and `javascript:` URLs. The frame stays strictly sandboxed.
 */
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'background', 'srcset'];
// Browsers ignore tabs, line breaks and leading control characters inside a URL scheme.
// eslint-disable-next-line no-control-regex
const JS_URL = /^[\u0000- ]*j[\t\n\r]*a[\t\n\r]*v[\t\n\r]*a[\t\n\r]*s[\t\n\r]*c[\t\n\r]*r[\t\n\r]*i[\t\n\r]*p[\t\n\r]*t[\t\n\r]*:/i;

export function inertHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, link[rel~="modulepreload"], link[rel~="preload"][as="script"]').forEach((el) => el.remove());
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (URL_ATTRS.includes(name) && JS_URL.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
  return doctype + doc.documentElement.outerHTML;
}
