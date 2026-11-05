import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { makeGql, makeGqlOk } from '../helpers';
import { seedCatalog } from '../seed';

describe('rich text, publishing, SEO and files', () => {
  let t: TestApp;
  let g: ReturnType<typeof makeGqlOk>;
  let cat: Awaited<ReturnType<typeof seedCatalog>>;

  beforeAll(async () => {
    t = await createTestApp();
    g = makeGqlOk(makeGql(t.app, await setupAndLogin(t.app)));
    cat = await seedCatalog(g);
  }, 120_000);
  afterAll(async () => { await t.close(); });

  it('sanitizes page, article and product HTML on write', async () => {
    const dirty = '<p onclick=\\"x()\\">Hi</p><script>alert(1)</script><table><tr><td style=\\"text-align:center\\">c</td></tr></table><iframe src=\\"https://evil.example/x\\"></iframe><iframe src=\\"https://www.youtube.com/embed/abc\\"></iframe>';
    const page = await g(`mutation { pageCreate(page: { title: "Clean", body: "${dirty}", isPublished: true }) { page { id body } userErrors { message } } }`);
    const body: string = page.pageCreate.page.body;
    expect(body).not.toMatch(/script|onclick|evil\.example/);
    expect(body).toContain('<table>');
    expect(body).toContain('text-align:center');
    expect(body).toContain('youtube.com/embed/abc');

    const art = await g(`mutation { articleCreate(blog: { title: "News" }, article: { title: "A", author: { name: "Me" }, body: "${dirty}", summary: "<b onmouseover=\\"x\\">s</b>" }) { article { body summary } userErrors { message } } }`);
    expect(art.articleCreate.article.body).not.toMatch(/script|onclick|evil\.example/);
    expect(art.articleCreate.article.summary).toBe('<b>s</b>');

    const prod = await g(`mutation { productUpdate(product: { id: "${cat.minimal.id}", descriptionHtml: "${dirty}" }) { product { descriptionHtml } userErrors { message } } }`);
    expect(prod.productUpdate.product.descriptionHtml).not.toMatch(/script|onclick|evil\.example/);
  });

  it('stores SEO title and description on pages and articles', async () => {
    const p = await g(`mutation { pageCreate(page: { title: "About", seo: { title: "About us", description: "Who we are" } }) { page { id seo { title description } } userErrors { message } } }`);
    expect(p.pageCreate.page.seo).toEqual({ title: 'About us', description: 'Who we are' });
    const u = await g(`mutation { pageUpdate(id: "${p.pageCreate.page.id}", page: { seo: { title: "About", description: null } }) { page { seo { title description } } userErrors { message } } }`);
    expect(u.pageUpdate.page.seo).toEqual({ title: 'About', description: null });
    const a = await g(`mutation { articleCreate(blog: { title: "SEO blog" }, article: { title: "S", author: { name: "Me" }, seo: { title: "T", description: "D" } }) { article { seo { title description } } userErrors { message } } }`);
    expect(a.articleCreate.article.seo).toEqual({ title: 'T', description: 'D' });
  });

  it('schedules a page for later and lists theme template suffixes', async () => {
    const future = new Date(Math.floor(Date.now() / 1000) * 1000 + 86_400_000).toISOString();
    const p = await g(`mutation { pageCreate(page: { title: "Soon", publishDate: "${future}" }) { page { isPublished publishedAt } userErrors { message } } }`);
    expect(p.pageCreate.page.isPublished).toBe(false);
    expect(new Date(p.pageCreate.page.publishedAt).toISOString()).toBe(future);
    const res = await t.app.inject({ method: 'GET', url: '/pages/soon', headers: { host: 'localhost' } });
    expect(res.statusCode).toBe(404);

    const s = await g(`{ shopmeTemplateSuffixes(kind: "page") }`);
    expect(Array.isArray(s.shopmeTemplateSuffixes)).toBe(true);
    const none = await g(`{ shopmeTemplateSuffixes(kind: "no such") }`);
    expect(none.shopmeTemplateSuffixes).toEqual([]);
  });

  it('manages file folders, sizes and references', async () => {
    const f = await g(`mutation { shopmeFileFolderCreate(name: "Banners") { folder { id name } userErrors { message } } }`);
    const folder = f.shopmeFileFolderCreate.folder;
    expect(folder.name).toBe('Banners');
    const dup = await g(`mutation { shopmeFileFolderCreate(name: "banners") { folder { id } userErrors { message } } }`);
    expect(dup.shopmeFileFolderCreate.userErrors[0].message).toMatch(/already exists/);
    const ren = await g(`mutation { shopmeFileFolderRename(id: "${folder.id}", name: "Heroes") { folder { name } userErrors { message } } }`);
    expect(ren.shopmeFileFolderRename.folder.name).toBe('Heroes');

    const created = await g(`mutation { fileCreate(files: [{ originalSource: "https://example.com/pic.png", contentType: IMAGE }]) { files { id } userErrors { message } } }`);
    const fileId = created.fileCreate.files[0].id;
    const moved = await g(`mutation { shopmeFilesMove(fileIds: ["${fileId}"], folderId: "${folder.id}") { files { id } userErrors { message } } }`);
    expect(moved.shopmeFilesMove.userErrors).toEqual([]);

    const inFolder = await g(`{ files(first: 10, query: "folder:${folder.id.split('/').pop()}") { nodes { id shopmeFolder { name } shopmeFilename shopmeReferences { type } } } }`);
    expect(inFolder.files.nodes).toHaveLength(1);
    expect(inFolder.files.nodes[0]).toMatchObject({ shopmeFolder: { name: 'Heroes' }, shopmeFilename: 'pic.png', shopmeReferences: [] });

    const busy = await g(`mutation { shopmeFileFolderDelete(id: "${folder.id}") { deletedFolderId userErrors { message } } }`);
    expect(busy.shopmeFileFolderDelete.userErrors[0].message).toMatch(/not empty/);
    await g(`mutation { shopmeFilesMove(fileIds: ["${fileId}"]) { userErrors { message } } }`);
    const del = await g(`mutation { shopmeFileFolderDelete(id: "${folder.id}") { deletedFolderId userErrors { message } } }`);
    expect(del.shopmeFileFolderDelete.deletedFolderId).toBe(folder.id);
    const list = await g(`{ shopmeFileFolders { name } }`);
    expect(list.shopmeFileFolders).toEqual([]);
  });

  it('reports where a file is used', async () => {
    const created = await g(`mutation { fileCreate(files: [{ originalSource: "https://example.com/used.png", contentType: IMAGE }]) { files { id } userErrors { message } } }`);
    const id = created.fileCreate.files[0].id;
    await g(`mutation { articleCreate(blog: { title: "Refs" }, article: { title: "With image", author: { name: "Me" } }) { article { id } } }`);
    const withProduct = await g(`mutation { productCreateMedia(productId: "${cat.minimal.id}", media: [{ originalSource: "https://example.com/p.png", mediaContentType: IMAGE }]) { media { id } userErrors { message } } }`);
    expect(withProduct.productCreateMedia.userErrors).toEqual([]);
    const all = await g(`{ files(first: 50) { nodes { id shopmeReferences { type title } ... on MediaImage { originalSource { url fileSize } } } } }`);
    const used = all.files.nodes.filter((n: { shopmeReferences: unknown[] }) => n.shopmeReferences.length);
    expect(used.some((n: { shopmeReferences: { type: string }[] }) => n.shopmeReferences[0]!.type === 'PRODUCT')).toBe(true);
    expect(all.files.nodes.find((n: { id: string }) => n.id === id).shopmeReferences).toEqual([]);
  });
});
