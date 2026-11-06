import {
  copyThemeFiles, createThemeFromZip, deleteTheme, deleteThemeFiles, duplicateTheme, fetchSafely, findBundledTheme, installBundledTheme, listThemeFiles, MAX_THEME_ZIP_BYTES, readThemeReleaseNotes, renameTheme,
  themeUpdateStatus, updateThemeToBundled, type RemovedReference, type SkippedFile, type Theme as ThemeRow, type ThemeFile, type ThemeReleaseNote, type ThemeUpdateResult, type ThemeUpdateStatus,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
import { listBundledThemes, type BundledThemeListing } from '../../themes-routes';
import { themeRoots } from '../../../paths';
import { builder } from '../builder';
import { requireScope } from '../context';
import { payloadWith, typedUserError } from '../types/sales';
import { Theme, ThemeFilesError, ThemeRoleEnum, UpsertResult } from './content';

const staffId = (ctx: { auth: { kind: string; user?: { id: number } } }) => (ctx.auth.kind === 'session' ? ctx.auth.user!.id : null);
const themeId = (raw: string) => parseId(String(raw), 'OnlineStoreTheme');
const nope = (field: string[], message: string, code = 'NOT_FOUND'): UserError[] => [{ field, message, code }];
type Err = UserError & { filename?: string | null };

const CreateError = typedUserError('ThemeCreateUserError', ['INVALID', 'NOT_FOUND', 'THEME_CREATE_FAILED'] as const);
const DeleteError = typedUserError('ThemeDeleteUserError', ['INVALID', 'NOT_FOUND', 'CANNOT_DELETE_MAIN_THEME'] as const);
const DuplicateError = typedUserError('ThemeDuplicateUserError', ['INVALID', 'NOT_FOUND'] as const);
const UpdateError = typedUserError('ThemeUpdateUserError', ['INVALID', 'NOT_FOUND', 'BLANK'] as const);
const BundledUpdateError = typedUserError('ShopmeThemeUpdateToBundledUserError', ['INVALID', 'NOT_FOUND', 'NOT_BUNDLED_THEME', 'UP_TO_DATE', 'BUNDLE_UNAVAILABLE'] as const);

const ThemeCreatePayload = payloadWith<{ theme: ThemeRow | null }>('ThemeCreatePayload', CreateError, (t) => ({ theme: t.field({ type: Theme, nullable: true, resolve: (p) => p.theme }) }));
const ThemeDeletePayload = payloadWith<{ deletedThemeId: string | null }>('ThemeDeletePayload', DeleteError, (t) => ({ deletedThemeId: t.id({ nullable: true, resolve: (p) => p.deletedThemeId }) }));
const ThemeDuplicatePayload = payloadWith<{ newTheme: ThemeRow | null }>('ThemeDuplicatePayload', DuplicateError, (t) => ({ newTheme: t.field({ type: Theme, nullable: true, resolve: (p) => p.newTheme }) }));
const ThemeUpdatePayload = payloadWith<{ theme: ThemeRow | null }>('ThemeUpdatePayload', UpdateError, (t) => ({ theme: t.field({ type: Theme, nullable: true, resolve: (p) => p.theme }) }));

const fileOps = (name: string, field: string) => builder.objectRef<{ files: ThemeFile[] | null; userErrors: Err[] }>(name).implement({
  fields: (t) => ({
    [field]: t.field({ type: [UpsertResult], nullable: true, resolve: (p) => p.files }),
    userErrors: t.field({ type: [ThemeFilesError], resolve: (p) => p.userErrors }),
  }),
});
const FilesCopyPayload = fileOps('ThemeFilesCopyPayload', 'copiedThemeFiles');
const FilesDeletePayload = fileOps('ThemeFilesDeletePayload', 'deletedThemeFiles');


const ThemeInput = builder.inputType('OnlineStoreThemeInput', { fields: (t) => ({ name: t.string() }) });
const CopyFileInput = builder.inputType('ThemeFilesCopyFileInput', { fields: (t) => ({ dstFilename: t.string({ required: true }), srcFilename: t.string({ required: true }) }) });

builder.mutationFields((t) => ({
  themeCreate: t.field({
    type: ThemeCreatePayload, args: { source: t.arg.string({ required: true }), name: t.arg.string(), role: t.arg({ type: ThemeRoleEnum }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      if (!/^https?:\/\//i.test(a.source)) return { theme: null, userErrors: nope(['source'], 'Source must be an http(s) URL to a zip file', 'INVALID') };
      const got = await fetchSafely(a.source, MAX_THEME_ZIP_BYTES).catch(() => null);
      if (!got) return { theme: null, userErrors: nope(['source'], 'The theme could not be downloaded from the source URL', 'THEME_CREATE_FAILED') };
      const r = await createThemeFromZip(ctx.db, ctx.app.storageFor(ctx.shopId), ctx.shopId, got.data, { name: a.name, role: a.role, staffId: staffId(ctx) });
      return r.ok ? { theme: r.value.theme, userErrors: [] } : { theme: null, userErrors: r.errors };
    },
  }),
  themeDelete: t.field({
    type: ThemeDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.id);
      const r = id ? await deleteTheme(ctx.db, ctx.app.storageFor(ctx.shopId), ctx.shopId, id) : null;
      if (!r) return { deletedThemeId: null, userErrors: nope(['id'], 'Theme does not exist') };
      return r.ok ? { deletedThemeId: toGid('OnlineStoreTheme', id!), userErrors: [] } : { deletedThemeId: null, userErrors: r.errors };
    },
  }),
  themeDuplicate: t.field({
    type: ThemeDuplicatePayload, args: { id: t.arg.id({ required: true }), name: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.id);
      const r = id ? await duplicateTheme(ctx.db, ctx.shopId, id, a.name) : null;
      if (!r) return { newTheme: null, userErrors: nope(['id'], 'Theme does not exist') };
      return r.ok ? { newTheme: r.value, userErrors: [] } : { newTheme: null, userErrors: r.errors };
    },
  }),
  themeUpdate: t.field({
    type: ThemeUpdatePayload, args: { id: t.arg.id({ required: true }), input: t.arg({ type: ThemeInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.id);
      const r = id ? await renameTheme(ctx.db, ctx.shopId, id, a.input.name) : null;
      if (!r) return { theme: null, userErrors: nope(['id'], 'Theme does not exist') };
      return r.ok ? { theme: r.value, userErrors: [] } : { theme: null, userErrors: r.errors };
    },
  }),
  themeFilesCopy: t.field({
    type: FilesCopyPayload, args: { themeId: t.arg.id({ required: true }), files: t.arg({ type: [CopyFileInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.themeId);
      if (!id) return { files: null, userErrors: nope(['themeId'], 'Theme does not exist') };
      const r = await copyThemeFiles(ctx.db, ctx.shopId, id, a.files);
      if (!r.ok) return { files: null, userErrors: r.errors };
      return { files: await listThemeFiles(ctx.db, ctx.shopId, id, { filenames: r.value, offset: 0, limit: 250 }), userErrors: [] };
    },
  }),
  themeFilesDelete: t.field({
    type: FilesDeletePayload, args: { themeId: t.arg.id({ required: true }), files: t.arg.stringList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.themeId);
      if (!id) return { files: null, userErrors: nope(['themeId'], 'Theme does not exist') };
      const r = await deleteThemeFiles(ctx.db, ctx.app.storageFor(ctx.shopId), ctx.shopId, id, a.files, staffId(ctx));
      if (!r.ok) return { files: null, userErrors: r.errors };
      const now = new Date();
      return { files: r.value.map((path) => ({ path, checksum: null, sizeBytes: 0, updatedAt: now }) as unknown as ThemeFile), userErrors: [] };
    },
  }),
}));

/* ------------------------------ bundled themes: gallery, install, updates ------------------------------ */

const ReleaseNote = builder.objectRef<ThemeReleaseNote>('ShopmeThemeReleaseNote').implement({
  description: 'What changed in one version of the bundled theme.',
  fields: (t) => ({
    version: t.exposeString('version'),
    date: t.string({ nullable: true, resolve: (n) => n.date }),
    notes: t.stringList({ resolve: (n) => n.notes }),
  }),
});

type BundledStatus = ThemeUpdateStatus & { handle: string; dir: string };
const BundledTheme = builder.objectRef<BundledStatus>('ShopmeBundledTheme').implement({
  description: 'The bundled theme a theme was installed from, and whether the server ships a newer version of it.',
  fields: (t) => ({
    handle: t.exposeString('handle', { description: 'Handle of the bundled theme (`aurora`, or the folder name of the theme in packages/themes).' }),
    name: t.exposeString('name'),
    installedVersion: t.string({ nullable: true, resolve: (b) => b.installedVersion }),
    bundledVersion: t.exposeString('bundledVersion'),
    updateAvailable: t.exposeBoolean('updateAvailable'),
    releaseNotes: t.field({
      type: [ReleaseNote], description: 'Changes in the versions after the installed one, newest first.', args: { locale: t.arg.string({ defaultValue: 'en' }) },
      resolve: (b, a) => readThemeReleaseNotes(b.dir, a.locale ?? 'en', { after: b.installedVersion, upTo: b.bundledVersion }),
    }),
  }),
});

builder.objectFields(Theme, (t) => ({
  shopmeBundledTheme: t.field({
    type: BundledTheme, nullable: true, description: 'Set when the theme was installed from a theme bundled with ShopMe (Aurora or a theme of packages/themes) that this server still ships.',
    resolve: (th, _a, ctx) => {
      const info = th.originTheme ? findBundledTheme(themeRoots(ctx.app.paths), th.originTheme) : null;
      const status = themeUpdateStatus(th, info);
      return status && info ? { ...status, handle: info.handle, dir: info.dir } : null;
    },
  }),
}));

const SkipReasonEnum = builder.enumType('ShopmeThemeUpdateSkipReason', {
  values: {
    EDITED: { description: 'Edited in the code editor: the new version of the file is used and the edit must be made again.' },
    REMOVED_IN_NEW_VERSION: { description: 'Edited, but the new version no longer has this file.' },
    UNREADABLE: { description: 'Not valid JSON: the new version of the file is used.' },
  } as const,
});
const SkippedFileRef = builder.objectRef<SkippedFile>('ShopmeThemeUpdateSkippedFile').implement({
  fields: (t) => ({ filename: t.exposeString('filename'), reason: t.field({ type: SkipReasonEnum, resolve: (f) => f.reason }) }),
});
const ReferenceKind = builder.enumType('ShopmeThemeUpdateReferenceKind', { values: ['SECTION', 'BLOCK'] as const });
const RemovedReferenceRef = builder.objectRef<RemovedReference>('ShopmeThemeUpdateRemovedReference').implement({
  description: 'A section or block of a template or section group whose type the new version no longer has; it was left out.',
  fields: (t) => ({ filename: t.exposeString('filename'), kind: t.field({ type: ReferenceKind, resolve: (r) => r.kind }), id: t.exposeString('id'), type: t.exposeString('type') }),
});

const UpdateToBundledPayload = payloadWith<{ result: ThemeUpdateResult | null }>('ShopmeThemeUpdateToBundledPayload', BundledUpdateError, (t) => ({
  theme: t.field({ type: Theme, nullable: true, description: 'The new, unpublished copy at the bundled version.', resolve: (p) => p.result?.theme ?? null }),
  previousVersion: t.string({ nullable: true, resolve: (p) => p.result?.fromVersion ?? null }),
  version: t.string({ nullable: true, resolve: (p) => p.result?.toVersion ?? null }),
  carriedOverFiles: t.stringList({ description: 'Files of the merchant kept or merged into the copy: settings, templates, section groups, language edits, own files.', resolve: (p) => p.result?.carriedOver ?? [] }),
  skippedFiles: t.field({ type: [SkippedFileRef], description: 'Edited theme files that were not carried over.', resolve: (p) => p.result?.skipped ?? [] }),
  removedReferences: t.field({ type: [RemovedReferenceRef], resolve: (p) => p.result?.removedReferences ?? [] }),
  removedSettings: t.stringList({ description: 'Theme setting ids the new version no longer has.', resolve: (p) => p.result?.removedSettings ?? [] }),
}));

builder.mutationFields((t) => ({
  shopmeThemeUpdateToBundled: t.field({
    type: UpdateToBundledPayload, args: { id: t.arg.id({ required: true }) },
    description: "Create a new, unpublished copy of a theme installed from the bundled theme, at the version the server ships, with the merchant's customizations carried over. The original theme is not changed.",
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.id);
      if (!id) return { result: null, userErrors: nope(['id'], 'Theme does not exist') };
      const r = await updateThemeToBundled(ctx.db, ctx.app.storageFor(ctx.shopId), ctx.shopId, id, themeRoots(ctx.app.paths), { staffId: staffId(ctx) });
      return r.ok ? { result: r.value, userErrors: [] } : { result: null, userErrors: r.errors };
    },
  }),
}));

const BundledPreviews = builder.objectRef<BundledThemeListing['previews']>('ShopmeBundledThemePreviews').implement({
  description: 'Home page previews of a bundled theme: URLs of images served to signed-in admins (null when there is none).',
  fields: (t) => ({
    desktop: t.string({ nullable: true, resolve: (p) => p.desktop }),
    mobile: t.string({ nullable: true, resolve: (p) => p.mobile }),
  }),
});
const BundledListing = builder.objectRef<BundledThemeListing>('ShopmeBundledThemeListing').implement({
  description: 'A theme that ships with ShopMe and can be added to the theme library.',
  fields: (t) => ({
    handle: t.exposeString('handle'),
    name: t.exposeString('name'),
    version: t.exposeString('version'),
    author: t.exposeString('author'),
    description: t.exposeString('description'),
    tags: t.stringList({ resolve: (b) => b.tags }),
    previews: t.field({ type: BundledPreviews, resolve: (b) => b.previews }),
    templates: t.stringList({ description: 'Pages the theme has a template for (`index`, `product`, `customers/login`...).', resolve: (b) => b.templates }),
    changelog: t.field({ type: [ReleaseNote], description: 'What changed in each version of the theme, newest first.', resolve: (b) => b.changelog }),
  }),
});

builder.queryFields((t) => ({
  shopmeBundledThemes: t.field({
    type: [BundledListing], args: { locale: t.arg.string({ defaultValue: 'en', description: 'Language of the descriptions (falls back to English).' }) },
    description: 'The themes bundled with ShopMe: Aurora and the themes of packages/themes.',
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_themes'); return listBundledThemes(ctx.app.paths, a.locale); },
  }),
}));

const InstallBundledError = typedUserError('ShopmeThemeInstallBundledUserError', ['NOT_FOUND'] as const);
const InstallBundledPayload = payloadWith<{ theme: ThemeRow | null }>('ShopmeThemeInstallBundledPayload', InstallBundledError, (t) => ({
  theme: t.field({ type: Theme, nullable: true, description: 'The new, unpublished theme.', resolve: (p) => p.theme }),
}));

builder.mutationFields((t) => ({
  shopmeThemeInstallBundled: t.field({
    type: InstallBundledPayload, args: { handle: t.arg.string({ required: true }) },
    description: "Add a bundled theme to the theme library as a new, unpublished theme (with the seed texts of the shop's language when the theme has them), and record where it came from so updates can be offered.",
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const info = findBundledTheme(themeRoots(ctx.app.paths), a.handle.trim().toLowerCase());
      if (!info) return { theme: null, userErrors: nope(['handle'], 'No bundled theme has this handle') };
      return { theme: await installBundledTheme(ctx.db, ctx.app.storageFor(ctx.shopId), ctx.shopId, info, { staffId: staffId(ctx) }), userErrors: [] };
    },
  }),
}));
