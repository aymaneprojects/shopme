import type { Liquid } from 'liquidjs';

interface Rgba { r: number; g: number; b: number; a: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return { ...hslToRgb(+m[1]!, +m[2]!, +m[3]!), a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  return null;
}

function rgbToHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const S = clamp(s, 0, 100) / 100, L = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  return { r: Math.round((r1! + m) * 255), g: Math.round((g1! + m) * 255), b: Math.round((b1! + m) * 255) };
}

const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** `#rrggbb` when opaque, else `rgba(r, g, b, a)`. */
export function formatColor(c: Rgba): string {
  return c.a >= 1 ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(2)})`;
}

const luminance = ({ r, g, b }: Rgba) => {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function colorBrightness(c: Rgba): number { return (c.r * 299 + c.g * 587 + c.b * 114) / 1000; }

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function modify(c: Rgba, channel: string, value: number): Rgba {
  const hsl = rgbToHsl(c);
  switch (channel) {
    case 'red': return { ...c, r: clamp(value, 0, 255) };
    case 'green': return { ...c, g: clamp(value, 0, 255) };
    case 'blue': return { ...c, b: clamp(value, 0, 255) };
    case 'alpha': return { ...c, a: clamp(value, 0, 1) };
    case 'hue': return { ...hslToRgb(value, hsl.s, hsl.l), a: c.a };
    case 'saturation': return { ...hslToRgb(hsl.h, value, hsl.l), a: c.a };
    case 'lightness': return { ...hslToRgb(hsl.h, hsl.s, value), a: c.a };
    default: return c;
  }
}

export function registerColorFilters(l: Liquid): void {
  const wrap = (fn: (c: Rgba, ...a: any[]) => unknown) => function (v: unknown, ...a: unknown[]) {
    const c = parseColor(v);
    return c ? fn(c, ...a) : v;
  };
  l.registerFilter('color_modify', wrap((c, channel: string, value: unknown) => formatColor(modify(c, String(channel), Number(value)))));
  l.registerFilter('color_lighten', wrap((c, n: unknown) => { const h = rgbToHsl(c); return formatColor({ ...hslToRgb(h.h, h.s, h.l + Number(n)), a: c.a }); }));
  l.registerFilter('color_darken', wrap((c, n: unknown) => { const h = rgbToHsl(c); return formatColor({ ...hslToRgb(h.h, h.s, h.l - Number(n)), a: c.a }); }));
  l.registerFilter('color_saturate', wrap((c, n: unknown) => { const h = rgbToHsl(c); return formatColor({ ...hslToRgb(h.h, h.s + Number(n), h.l), a: c.a }); }));
  l.registerFilter('color_desaturate', wrap((c, n: unknown) => { const h = rgbToHsl(c); return formatColor({ ...hslToRgb(h.h, h.s - Number(n), h.l), a: c.a }); }));
  l.registerFilter('color_brightness', wrap((c) => colorBrightness(c)));
  l.registerFilter('color_contrast', wrap((c, other: unknown) => { const o = parseColor(other); return o ? contrastRatio(c, o) : 1; }));
  l.registerFilter('color_difference', wrap((c, other: unknown) => {
    const o = parseColor(other);
    if (!o) return 0;
    return (Math.max(c.r, o.r) - Math.min(c.r, o.r)) + (Math.max(c.g, o.g) - Math.min(c.g, o.g)) + (Math.max(c.b, o.b) - Math.min(c.b, o.b));
  }));
  l.registerFilter('color_mix', wrap((c, other: unknown, pct: unknown) => {
    const o = parseColor(other);
    if (!o) return formatColor(c);
    const p = clamp(Number(pct), 0, 100) / 100;
    return formatColor({ r: c.r * p + o.r * (1 - p), g: c.g * p + o.g * (1 - p), b: c.b * p + o.b * (1 - p), a: c.a * p + o.a * (1 - p) });
  }));
  l.registerFilter('color_extract', wrap((c, channel: unknown) => {
    const h = rgbToHsl(c);
    const map: Record<string, number> = { red: c.r, green: c.g, blue: c.b, alpha: c.a, hue: h.h, saturation: h.s, lightness: h.l };
    return map[String(channel)] ?? 0;
  }));
  l.registerFilter('color_to_rgb', wrap((c) => (c.a >= 1 ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(2)})`)));
  l.registerFilter('color_to_hsl', wrap((c) => { const h = rgbToHsl(c); const b = `${Math.round(h.h)}, ${Math.round(h.s)}%, ${Math.round(h.l)}%`; return c.a >= 1 ? `hsl(${b})` : `hsla(${b}, ${+c.a.toFixed(2)})`; }));
  l.registerFilter('color_to_hex', wrap((c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`));
}
