// Groups the presets of the "Add section" picker: the preset's own `category`, else keywords in the section type and name.

export const CATEGORY_ORDER = ['banners', 'collections', 'products', 'content', 'media', 'blog', 'forms', 'layout', 'other'] as const;
export type CategoryId = (typeof CATEGORY_ORDER)[number];

const RULES: Array<[CategoryId, RegExp]> = [
  ['forms', /newsletter|contact|form|email|subscribe|signup|sign-up|login|register/],
  ['banners', /banner|hero|slideshow|slider|carousel|announcement|marquee|splash/],
  ['collections', /collection/],
  ['products', /product|featured|bestsell|recommend|cart|upsell|gift/],
  ['blog', /blog|article|post|news/],
  ['media', /image|video|gallery|logo|media|testimonial|instagram|social/],
  ['layout', /header|footer|menu|nav|breadcrumb|divider|spacer|custom-section|columns|multicolumn/],
  ['content', /text|rich|heading|faq|accordion|collapsible|page|about|story|content|feature|icon|usp|trust|map|html|liquid/],
];

const BY_NAME: Record<string, CategoryId> = {
  banner: 'banners', banners: 'banners', collection: 'collections', collections: 'collections', product: 'products', products: 'products',
  text: 'content', content: 'content', image: 'media', images: 'media', media: 'media', video: 'media', blog: 'blog', form: 'forms', forms: 'forms',
  layout: 'layout', header: 'layout', footer: 'layout',
};

export function categoryOf(type: string, name: string, presetCategory?: string): CategoryId {
  const own = presetCategory?.trim().toLowerCase();
  if (own && BY_NAME[own]) return BY_NAME[own];
  const hay = `${type} ${name}`.toLowerCase();
  for (const [id, re] of RULES) if (re.test(hay)) return id;
  return 'other';
}

export interface PickerItem { type: string; presetIndex: number; name: string; category: CategoryId }

/** Items filtered by `needle` (name, type or category label) and grouped in display order. */
export function groupItems(items: PickerItem[], needle: string, categoryLabel: (c: CategoryId) => string): Array<{ id: CategoryId; items: PickerItem[] }> {
  const n = needle.trim().toLowerCase();
  const kept = items.filter((i) => !n || i.name.toLowerCase().includes(n) || i.type.toLowerCase().includes(n) || categoryLabel(i.category).toLowerCase().includes(n));
  return CATEGORY_ORDER.map((id) => ({ id, items: kept.filter((i) => i.category === id).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
}
