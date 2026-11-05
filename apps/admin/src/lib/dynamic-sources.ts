// Dynamic sources: a text setting can show data of the page it sits on. The setting holds a Liquid output such as
// `{{ closest.product.title }}`, which the storefront evaluates (`closest` is the nearest product, collection, article or blog of the page).
import type { Key } from '../i18n';

export interface DynamicSource { id: string; label: Key; token: string }

const shop: DynamicSource[] = [{ id: 'shop.name', label: 'bs.src.shopName', token: '{{ shop.name }}' }];

const BY_TEMPLATE: Record<string, DynamicSource[]> = {
  product: [
    { id: 'product.title', label: 'bs.src.productTitle', token: '{{ closest.product.title }}' },
    { id: 'product.vendor', label: 'bs.src.productVendor', token: '{{ closest.product.vendor }}' },
    { id: 'product.type', label: 'bs.src.productType', token: '{{ closest.product.type }}' },
    { id: 'product.price', label: 'bs.src.productPrice', token: '{{ closest.product.price | money }}' },
    { id: 'product.description', label: 'bs.src.productDescription', token: '{{ closest.product.description }}' },
  ],
  collection: [
    { id: 'collection.title', label: 'bs.src.collectionTitle', token: '{{ closest.collection.title }}' },
    { id: 'collection.description', label: 'bs.src.collectionDescription', token: '{{ closest.collection.description }}' },
    { id: 'collection.count', label: 'bs.src.collectionCount', token: '{{ closest.collection.products_count }}' },
  ],
  article: [
    { id: 'article.title', label: 'bs.src.articleTitle', token: '{{ closest.article.title }}' },
    { id: 'article.author', label: 'bs.src.articleAuthor', token: '{{ closest.article.author }}' },
    { id: 'article.excerpt', label: 'bs.src.articleExcerpt', token: '{{ closest.article.excerpt_or_content | strip_html | truncatewords: 30 }}' },
    { id: 'article.date', label: 'bs.src.articleDate', token: "{{ closest.article.published_at | date: '%B %-d, %Y' }}" },
  ],
  blog: [{ id: 'blog.title', label: 'bs.src.blogTitle', token: '{{ closest.blog.title }}' }],
  page: [{ id: 'page.title', label: 'bs.src.pageTitle', token: '{{ page.title }}' }],
};

/** The sources a setting can read on a template (`product`, `page.contact`, ...). */
export function sourcesFor(template: string): DynamicSource[] {
  return [...(BY_TEMPLATE[template.split('.')[0]!] ?? []), ...shop];
}

const OUTPUT = /\{\{[^}]*\}\}/g;
export const hasSource = (value: string): boolean => /\{\{[^}]*\}\}/.test(value);
/** The value with every Liquid output removed. */
export const withoutSources = (value: string): string => value.replace(OUTPUT, '').replace(/<p>\s*<\/p>/g, '');

/** Add a source to a value: a plain text setting gets it appended, rich text gets it in its own paragraph. */
export function insertSource(value: string, token: string, rich: boolean): string {
  if (rich) return `${value}<p>${token}</p>`;
  return value ? `${value} ${token}` : token;
}
