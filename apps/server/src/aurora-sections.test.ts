import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from './test-utils';

/** One instance of every section Aurora ships for the editor's "Add section" picker, with the blocks its presets use. */
const SECTIONS: Record<string, unknown> = {
  hero: { type: 'hero', settings: { heading: 'Hero zq1', vertical_align: 'bottom', direction: 'horizontal', section_link: '/collections/all', section_link_new_tab: true } },
  herovideo: { type: 'hero', settings: { heading: 'Hero video', media_type: 'video', video_url: 'https://www.youtube.com/watch?v=abc123XYZ_-' } },
  slides: { type: 'slideshow', settings: { variant: 'inset' }, blocks: { a: { type: 'slide', settings: { heading: 'Slide one zq2' } }, b: { type: 'slide', settings: { heading: 'Slide two' } } }, block_order: ['a', 'b'] },
  marquee: { type: 'scrolling-banner', blocks: { a: { type: 'text', settings: { text: 'Marquee zq3' } } }, block_order: ['a'] },
  biglogo: { type: 'big-logo', settings: { text: 'Big zq4' } },
  showcase: { type: 'split-showcase', blocks: { a: { type: 'panel', settings: { heading: 'Panel zq5' } }, b: { type: 'panel', settings: { heading: 'Other' } } }, block_order: ['a', 'b'] },
  links: { type: 'collection-links', blocks: { a: { type: 'link', settings: { collection: 'all', label: 'Links zq6' } } }, block_order: ['a'] },
  bento: { type: 'collection-list', settings: { layout: 'bento', color_scheme: 'scheme-2' } },
  carousel: { type: 'collection-list', settings: { layout: 'carousel' } },
  liquid: { type: 'custom-liquid', settings: { custom_liquid: '<p>Liquid zq7 {{ shop.name }}</p>' } },
  divider: { type: 'divider', settings: { style: 'dashed' } },
  contact: { type: 'contact-form', settings: { show_phone: true } },
  newsletter: { type: 'newsletter', settings: {} },
  popup: { type: 'popup', settings: { enabled: true, heading: 'Popup zq13' } },
  posts: { type: 'blog-posts', settings: { layout: 'carousel' } },
  product: { type: 'featured-product', settings: { product: 'house-espresso-blend' } },
  quotes: { type: 'testimonials', blocks: { a: { type: 'testimonial', settings: { quote: 'Quote zq8' } } }, block_order: ['a'] },
  gallery: { type: 'image-gallery', blocks: { a: { type: 'image', settings: { caption: 'Gallery zq9' } } }, block_order: ['a'] },
  video: { type: 'video', settings: { video_url: 'https://vimeo.com/123456' } },
  faq: { type: 'collapsible-content', settings: { open_first: true }, blocks: { a: { type: 'row', settings: { heading: 'FAQ zq10' } } }, block_order: ['a'] },
  columns: { type: 'multicolumn', blocks: { a: { type: 'column', settings: { title: 'Column zq11' } } }, block_order: ['a'] },
  story: { type: 'image-with-text', settings: { media_type: 'video', video_url: 'https://cdn.example.com/clip.mp4', stack_on_mobile: false, direction: 'vertical' } },
  rich: {
    type: 'rich-text', settings: { direction: 'horizontal' },
    blocks: { h: { type: 'heading', settings: { text: 'Block zq12', text_preset: 'h4', width: 'fill', max_width: 400, padding_top: 8, padding_left: 12, text_color: '#ff0000', show_background: true, background_color: '#00ff00', color_scheme: 'scheme-3' } }, t: { type: 'text', settings: { text: '<p>Text block</p>' } }, b: { type: 'button', settings: { label: 'Go', open_new_tab: true } } },
    block_order: ['h', 't', 'b'],
  },
};

describe('Aurora sections', () => {
  let t: TestApp;
  let cookie: string;
  let themeId: number;
  beforeAll(async () => {
    t = await createTestApp();
    cookie = await setupAndLogin(t.app);
    const r = await t.app.inject({ method: 'POST', url: '/admin/api/2026-10/graphql.json', cookies: { shopme_session: cookie }, payload: { query: '{ themes(first: 5) { nodes { id role } } }' } });
    themeId = Number(String(r.json().data.themes.nodes[0].id).split('/').pop());
  }, 60_000);
  afterAll(async () => { await t.close(); });

  it('renders every section without a Liquid error and applies its settings', async () => {
    const files = { 'templates/index.json': JSON.stringify({ sections: SECTIONS, order: Object.keys(SECTIONS) }) };
    const put = await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, cookies: { shopme_session: cookie }, payload: { files } });
    const { token } = put.json() as { token: string };
    const res = await t.app.inject({ url: `/?preview_theme_id=${themeId}&_draft=${token}`, cookies: { shopme_session: cookie } });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect([...html.matchAll(/<!-- Liquid error[^>]*-->/g)].map((m) => m[0])).toEqual([]);
    for (const text of ['Hero zq1', 'Slide one zq2', 'Marquee zq3', 'Big zq4', 'Panel zq5', 'Links zq6', 'Liquid zq7', 'Quote zq8', 'Gallery zq9', 'FAQ zq10', 'Column zq11', 'Block zq12']) expect(html, text).toContain(text);
    expect(html).toContain('hero--v-bottom');
    expect(html).toContain('hero--horizontal');
    expect(html).toContain('class="section-link" href="/collections/all" target="_blank"');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/abc123XYZ_-');
    expect(html).toContain('https://player.vimeo.com/video/123456');
    expect(html).toContain('<video class="media-video" src="https://cdn.example.com/clip.mp4"');
    expect(html).toContain('slideshow--inset');
    expect(html).toContain('collection-tiles--bento');
    expect(html).toContain('collection-tiles--carousel');
    expect(html).toContain('split--no-stack');
    expect(html).toContain('text-preset-h4');
    expect(html).toContain('--bb-max:400px');
    expect(html).toContain('--bb-pt:8px');
    expect(html).toContain('--bb-color:#ff0000');
    expect(html).toContain('--bb-bg:#00ff00');
    expect(html).toContain('color-scheme-3');
    expect(html).toContain('name="contact[phone]"');
    expect(html).toContain('name="contact[tags]" value="newsletter"');
    expect(html).toContain('footer-utilities');
    expect(html).toContain('data-popup');
  });

  it('emits color scheme variables, font faces, text presets and the favicon-ready head', async () => {
    const html = (await t.app.inject({ url: `/?preview_theme_id=${themeId}`, cookies: { shopme_session: cookie } })).body;
    expect(html).toMatch(/\.color-scheme-1 \{[^}]*--color-background: #f1f5f9/);
    expect(html).toContain('.color-scheme-2 {');
    expect(html).toContain('--preset-h1-size: calc(var(--font-size-base) * 3)');
    expect(html).toContain('--button-radius: 8px');
    expect(html).toContain('--font-heading: system-ui');
  });

  it('loads the self-hosted font a font setting picks', async () => {
    const data = JSON.stringify({ current: { type_heading_font: 'lora', type_body_font: 'inter' } });
    const put = await t.app.inject({ method: 'POST', url: `/admin/api/themes/${themeId}/preview-draft`, cookies: { shopme_session: cookie }, payload: { files: { 'config/settings_data.json': data } } });
    const { token } = put.json() as { token: string };
    const html = (await t.app.inject({ url: `/?preview_theme_id=${themeId}&_draft=${token}`, cookies: { shopme_session: cookie } })).body;
    expect(html).toContain("font-family: 'Aurora Lora'");
    expect(html).toContain("font-family: 'Aurora Inter'");
    expect(html).not.toContain("font-family: 'Aurora Manrope'");
    expect(html).toContain("--font-heading: 'Aurora Lora', Georgia, serif");
    const font = await t.app.inject({ url: html.match(/url\(([^)]*font-lora\.woff2[^)]*)\)/)![1]! });
    expect(font.statusCode).toBe(200);
  });
});
