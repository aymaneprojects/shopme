import sanitizeHtml from 'sanitize-html';

/** Hosts whose embeds may be kept as `<iframe>` (video players only). */
export const IFRAME_HOSTS = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'];

const TAGS = [
  'p', 'br', 'hr', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'mark',
  'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'iframe', 'video', 'source', 'audio', 'details', 'summary', 'font',
];

const CELL = ['colspan', 'rowspan', 'scope', 'align', 'valign', 'width', 'height'];
const SAFE_LENGTH = /^-?\d+(\.\d+)?(px|em|rem|%|pt)?$/;
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;

/** Inline styles that survive: alignment, colors, simple typography and sizing. Anything with url(), expression() or unknown properties is dropped. */
const ALLOWED_STYLES = {
  '*': {
    'text-align': [/^(left|right|center|justify)$/],
    color: [SAFE_COLOR], 'background-color': [SAFE_COLOR],
    'font-weight': [/^(normal|bold|[1-9]00)$/], 'font-style': [/^(normal|italic)$/], 'text-decoration': [/^(none|underline|line-through)( (none|underline|line-through))*$/],
    'margin-left': [SAFE_LENGTH], 'padding-left': [SAFE_LENGTH], 'text-indent': [SAFE_LENGTH],
    width: [SAFE_LENGTH], height: [SAFE_LENGTH], 'max-width': [SAFE_LENGTH],
  },
};

const hostOf = (src: string): string | null => {
  try {
    const u = new URL(src);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch { return null; }
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedAttributes: {
    '*': ['class', 'style', 'title', 'dir', 'lang', 'align'],
    a: ['href', 'target', 'rel', 'name', 'title'],
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading'],
    table: ['border', 'cellpadding', 'cellspacing', 'width'], td: CELL, th: CELL, col: ['span', 'width'], colgroup: ['span'],
    ol: ['start', 'type', 'reversed'], font: ['color', 'size'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'title', 'loading', 'referrerpolicy'],
    video: ['src', 'poster', 'controls', 'width', 'height', 'loop', 'muted', 'playsinline', 'preload'], audio: ['src', 'controls', 'loop', 'preload'], source: ['src', 'type'],
  },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'], video: ['http', 'https'], audio: ['http', 'https'], source: ['http', 'https'], iframe: ['https'] },
  allowProtocolRelative: false,
  allowedIframeHostnames: IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  transformTags: {
    a: (tag, attribs) => (attribs.target === '_blank' ? { tagName: tag, attribs: { ...attribs, rel: 'noopener noreferrer' } } : { tagName: tag, attribs }),
    iframe: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' } }),
  },
  exclusiveFilter: (f) => f.tag === 'iframe' && !(f.attribs.src && hostOf(f.attribs.src) && IFRAME_HOSTS.includes(hostOf(f.attribs.src)!)),
};

/**
 * Clean merchant-authored rich text (product/collection descriptions, pages, articles).
 * Keeps formatting, tables, alignment, links, images and YouTube/Vimeo iframes; removes scripts, event handlers,
 * `javascript:` URLs, other iframes and unsafe inline styles.
 */
export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/** Sanitize an optional field, leaving null/undefined untouched. */
export const cleanHtml = <T extends string | null | undefined>(html: T): T => (typeof html === 'string' ? (sanitizeRichHtml(html) as T) : html);
