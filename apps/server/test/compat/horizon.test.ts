import { existsSync } from 'node:fs';
import { installThemeFiles, readThemeDir, schema as s, seedDemo } from '@shopme/core';
import { analyzeTheme, createEngine, Theme } from '@shopme/liquid-compat';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../src/test-utils';

// Compatibility measurement against a third-party theme that is NOT part of this repository.
// Skipped unless the private reference copy exists. Prints numbers; asserts only that pages render at all.
const DIR = '/home/user/shoppen-re/raw/theme/horizon';

describe.skipIf(!existsSync(DIR))('Horizon compatibility (measurement)', () => {
  it('loads, renders home/product/collection/cart and reports unsupported tags and filters', async () => {
    const files = readThemeDir(DIR);
    const theme = new Theme(new Map(files.map((f) => [f.path, f.body])));
    const report = analyzeTheme(theme, createEngine(theme));

    const t = await createTestApp();
    try {
      await seedDemo(t.dbHandle.db, t.app.ctx.storage);
      const [shop] = await t.dbHandle.db.select().from(s.shops);
      const [main] = await t.dbHandle.db.select().from(s.themes).where(eq(s.themes.role, 'MAIN'));
      await installThemeFiles(t.dbHandle.db, shop!.id, main!.id, DIR);
      const pages: Record<string, { status: number; bytes: number; errors: string[] }> = {};
      for (const [name, url] of [['home', '/'], ['product', '/products/house-espresso-blend'], ['collection', '/collections/coffee'], ['cart', '/cart']] as const) {
        const r = await t.app.inject({ url });
        const errors = [...r.body.matchAll(/<!-- Liquid error \(([^)]*)\): ([^>]*?) -->/g)].map((m) => `${m[1]}: ${m[2]}`);
        pages[name] = { status: r.statusCode, bytes: r.body.length, errors };
        expect(r.statusCode, name).toBe(200);
        expect(r.body.length, name).toBeGreaterThan(1000);
      }
      const liquidFiles = report.files;
      const summary = {
        liquidFiles, parsed: report.parsed, parseFailures: report.parseFailures.length,
        unknownTags: report.unknownTags, unknownFilters: report.unknownFilters,
        pages: Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, { status: v.status, bytes: v.bytes, liquidErrors: v.errors.length }])),
      };
      console.log(`HORIZON COMPAT ${JSON.stringify(summary)}`);
      console.log(`HORIZON PARSE FAILURES ${JSON.stringify(report.parseFailures.slice(0, 10))}`);
      console.log(`HORIZON RENDER ERRORS ${JSON.stringify(Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, v.errors.slice(0, 8)])))}`);
    } finally {
      await t.close();
    }
  }, 120000);
});
