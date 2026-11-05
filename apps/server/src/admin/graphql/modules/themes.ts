import {
  copyThemeFiles, createThemeFromZip, deleteTheme, deleteThemeFiles, duplicateTheme, fetchSafely, listThemeFiles, MAX_THEME_ZIP_BYTES, renameTheme,
  type Theme as ThemeRow, type ThemeFile,
} from '@shopme/core';
import { parseId, toGid, type UserError } from '@shopme/shopify-compat';
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
      const r = await createThemeFromZip(ctx.db, ctx.app.storage, ctx.shopId, got.data, { name: a.name, role: a.role, staffId: staffId(ctx) });
      return r.ok ? { theme: r.value.theme, userErrors: [] } : { theme: null, userErrors: r.errors };
    },
  }),
  themeDelete: t.field({
    type: ThemeDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_themes');
      const id = themeId(a.id);
      const r = id ? await deleteTheme(ctx.db, ctx.app.storage, ctx.shopId, id) : null;
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
      const r = await deleteThemeFiles(ctx.db, ctx.app.storage, ctx.shopId, id, a.files, staffId(ctx));
      if (!r.ok) return { files: null, userErrors: r.errors };
      const now = new Date();
      return { files: r.value.map((path) => ({ path, checksum: null, sizeBytes: 0, updatedAt: now }) as unknown as ThemeFile), userErrors: [] };
    },
  }),
}));
