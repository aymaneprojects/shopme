import { Liquid, type FS } from 'liquidjs';
import { registerFilters } from './filters';
import { registerTags } from './tags';
import type { Theme } from './theme';

/** Read-only virtual file system over the theme files (`render 'x'` -> `snippets/x.liquid`). */
function themeFs(theme: Theme): FS {
  const join = (dir: string, file: string, ext: string) => `${dir ? `${dir}/` : ''}${file}${file.endsWith(ext) ? '' : ext}`;
  return {
    sep: '/',
    resolve: join,
    dirname: (f: string) => f.split('/').slice(0, -1).join('/'),
    contains: () => true,
    exists: async (f: string) => theme.has(f),
    existsSync: (f: string) => theme.has(f),
    readFile: async (f: string) => theme.source(f) ?? '',
    readFileSync: (f: string) => theme.source(f) ?? '',
  } as unknown as FS;
}

/** A LiquidJS engine for one theme with the Shopify dialect (tags, filters, `render` isolation, snippet lookup). */
export function createEngine(theme: Theme): Liquid {
  const liquid = new Liquid({
    fs: themeFs(theme),
    root: [''],
    partials: ['snippets'],
    layouts: ['layout'],
    extname: '.liquid',
    cache: true,
    strictFilters: false,
    strictVariables: false,
    lenientIf: true,
    renderLimit: 10_000,
    memoryLimit: 256 * 1024 * 1024,
  });
  registerTags(liquid);
  registerFilters(liquid);
  return liquid;
}
