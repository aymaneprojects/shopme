// ShopMe extensions for the theme code editor: a syntax check of theme files and the saved versions of a file (the history behind "Revert").
import { getThemeFileVersion, getTheme, listThemeFileVersions, listThemeFilesWithHistory, type ThemeFileVersion as VersionRow } from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { lintThemeFile, type ThemeDiagnostic } from '../../../theme-lint';

const themeId = (raw: string) => parseId(String(raw), 'OnlineStoreTheme');

const Severity = builder.enumType('ThemeDiagnosticSeverity', { values: ['ERROR', 'WARNING'] as const });
const Diagnostic = builder.objectRef<ThemeDiagnostic>('ThemeFileDiagnostic').implement({
  description: 'ShopMe extension: a problem found in a theme file.',
  fields: (t) => ({
    filename: t.exposeString('filename'), line: t.exposeInt('line'), column: t.exposeInt('column'), message: t.exposeString('message'),
    severity: t.field({ type: Severity, resolve: (d) => (d.severity === 'error' ? 'ERROR' : 'WARNING') }),
  }),
});
const LintInput = builder.inputType('ThemeFileLintInput', { fields: (t) => ({ filename: t.string({ required: true }), body: t.string({ required: true }) }) });

const Version = builder.objectRef<VersionRow>('ThemeFileVersion').implement({
  description: 'ShopMe extension: an earlier saved text of a theme file.',
  fields: (t) => ({
    id: t.id({ resolve: (v) => toGid('ThemeFileVersion', v.id) }),
    filename: t.exposeString('path'),
    size: t.exposeInt('sizeBytes'),
    createdAt: t.field({ type: 'DateTime', resolve: (v) => v.createdAt }),
    body: t.string({ nullable: true, resolve: (v) => v.body ?? null }),
  }),
});

builder.queryFields((t) => ({
  /** Syntax check of theme files (Liquid and JSON) without saving them. */
  themeFilesLint: t.field({
    type: [Diagnostic], args: { files: t.arg({ type: [LintInput], required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_themes'); return a.files.slice(0, 50).flatMap((f) => lintThemeFile(f.filename, f.body)); },
  }),
  /** Saved versions of a file, newest first (without their text; read one with `themeFileVersion`). */
  themeFileVersions: t.field({
    type: [Version], args: { themeId: t.arg.id({ required: true }), filename: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_themes');
      const id = themeId(a.themeId);
      return id && (await getTheme(ctx.db, ctx.shopId, id)) ? listThemeFileVersions(ctx.db, ctx.shopId, id, a.filename) : [];
    },
  }),
  themeFileVersion: t.field({
    type: Version, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_themes'); const id = parseId(String(a.id), 'ThemeFileVersion'); return id ? getThemeFileVersion(ctx.db, ctx.shopId, id) : null; },
  }),
  /** Files of the theme that were deleted or changed at least once, so the editor can offer to bring them back. */
  themeFilesWithHistory: t.stringList({
    args: { themeId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_themes'); const id = themeId(a.themeId); return id ? listThemeFilesWithHistory(ctx.db, ctx.shopId, id) : []; },
  }),
}));
