import { createHmac } from 'node:crypto';
import { createFolder, deleteFiles, deleteFolder, fileMeta, listFiles, listFolders, makeStorageKey, moveFiles, randomToken, renameFolder, updateFiles, type Folder } from '@shopme/core';
import { fromGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope } from '../context';
import { ConnectionArgs, defineConnection, paginate } from '../types/connection';
import { definePayload } from '../types/errors';
import { File_, defineTypedPayload } from '../types/catalog';
import { FileFolder, cacheFileMeta } from './files';

const FileConnection = defineConnection('File', File_ as never);
const FocalPointInput = builder.inputType('ShopmeFocalPointInput', { fields: (t) => ({ x: t.float({ required: true }), y: t.float({ required: true }) }) });
const FileUpdateInput = builder.inputType('FileUpdateInput', {
  fields: (t) => ({ id: t.id({ required: true }), alt: t.string(), originalSource: t.string(), previewImageSource: t.string(), filename: t.string(), focalPoint: t.field({ type: FocalPointInput, description: 'ShopMe extension: null clears the focal point.' }) }),
});
const FileUpdatePayload = defineTypedPayload<{ files: import('@shopme/core').Media[] | null }>('FileUpdatePayload', 'FilesUserError', (t) => ({
  files: t.field({ type: [File_], nullable: true, resolve: (p) => p.files }),
}));
const FileDeletePayload = defineTypedPayload<{ deletedFileIds: string[] | null }>('FileDeletePayload', 'FilesUserError', (t) => ({
  deletedFileIds: t.idList({ nullable: true, resolve: (p) => p.deletedFileIds }),
}));

const mediaId = (raw: string): number | null => { const g = fromGid(String(raw)); return g && /^(MediaImage|Video|ExternalVideo|Model3d|GenericFile)$/.test(g.type) ? g.id : null; };

builder.queryFields((t) => ({
  files: t.field({
    type: FileConnection, args: { ...ConnectionArgs, query: t.arg.string(), sortKey: t.arg.string({ defaultValue: 'ID' }) },
    resolve: (_r, a, ctx) => {
      requireScope(ctx, 'read_files');
      return paginate(a, {
        fetch: async ({ offset, limit }) => {
          const rows = await listFiles(ctx.db, ctx.shopId, { query: a.query, reverse: !!a.reverse, offset, limit });
          cacheFileMeta(rows, await fileMeta(ctx.db, ctx.shopId, rows));
          return rows;
        },
      });
    },
  }),
  shopmeFileFolders: t.field({
    type: [FileFolder], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_files'); return listFolders(ctx.db, ctx.shopId); },
  }),
}));

const FolderPayload = definePayload<{ folder: Folder | null }>('ShopmeFileFolderPayload', (t) => ({ folder: t.field({ type: FileFolder, nullable: true, resolve: (p) => p.folder }) }));
const FolderDeletePayload = definePayload<{ deletedFolderId: string | null }>('ShopmeFileFolderDeletePayload', (t) => ({ deletedFolderId: t.id({ nullable: true, resolve: (p) => p.deletedFolderId }) }));
const FilesMovePayload = definePayload<{ files: import('@shopme/core').Media[] | null }>('ShopmeFilesMovePayload', (t) => ({ files: t.field({ type: [File_], nullable: true, resolve: (p) => p.files }) }));
const folderId = (raw: string | null | undefined): number | null => { const n = Number(String(raw ?? '').split('/').pop()); return Number.isInteger(n) && n > 0 ? n : null; };

builder.mutationFields((t) => ({
  shopmeFileFolderCreate: t.field({
    type: FolderPayload, args: { name: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_files'); const r = await createFolder(ctx.db, ctx.shopId, a.name); return r.ok ? { folder: r.value, userErrors: [] } : { folder: null, userErrors: r.errors }; },
  }),
  shopmeFileFolderRename: t.field({
    type: FolderPayload, args: { id: t.arg.id({ required: true }), name: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_files');
      const id = folderId(String(a.id));
      if (!id) return { folder: null, userErrors: [{ field: ['id'], message: 'Folder does not exist', code: 'NOT_FOUND' }] };
      const r = await renameFolder(ctx.db, ctx.shopId, id, a.name);
      return r.ok ? { folder: r.value, userErrors: [] } : { folder: null, userErrors: r.errors };
    },
  }),
  shopmeFileFolderDelete: t.field({
    type: FolderDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_files');
      const id = folderId(String(a.id));
      if (!id) return { deletedFolderId: null, userErrors: [{ field: ['id'], message: 'Folder does not exist', code: 'NOT_FOUND' }] };
      const r = await deleteFolder(ctx.db, ctx.shopId, id);
      return r.ok ? { deletedFolderId: String(a.id), userErrors: [] } : { deletedFolderId: null, userErrors: r.errors };
    },
  }),
  shopmeFilesMove: t.field({
    type: FilesMovePayload, args: { fileIds: t.arg.idList({ required: true }), folderId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_files');
      const ids = a.fileIds.map((x) => mediaId(String(x)));
      const bad = ids.findIndex((x) => x == null);
      if (bad >= 0) return { files: null, userErrors: [{ field: ['fileIds', String(bad)], message: 'File does not exist', code: 'FILE_DOES_NOT_EXIST' }] };
      const target = a.folderId == null ? null : folderId(String(a.folderId));
      if (a.folderId != null && !target) return { files: null, userErrors: [{ field: ['folderId'], message: 'Folder does not exist', code: 'NOT_FOUND' }] };
      const r = await moveFiles(ctx.db, ctx.shopId, ids as number[], target);
      return r.ok ? { files: r.value, userErrors: [] } : { files: null, userErrors: r.errors };
    },
  }),
}));

/* ------------------------------ staged uploads: local targets ------------------------------ */

const StagedResource = builder.enumType('StagedUploadTargetGenerateUploadResource', {
  values: ['COLLECTION_IMAGE', 'FILE', 'IMAGE', 'MODEL_3D', 'PRODUCT_IMAGE', 'SHOP_IMAGE', 'VIDEO', 'BULK_MUTATION_VARIABLES', 'RETURN_LABEL', 'URL_REDIRECT_IMPORT', 'DISPUTE_FILE_UPLOAD'] as const,
});
const HttpMethod = builder.enumType('StagedUploadHttpMethodType', { values: ['POST', 'PUT'] as const });
const StagedUploadInput = builder.inputType('StagedUploadInput', {
  fields: (t) => ({ resource: t.field({ type: StagedResource, required: true }), filename: t.string({ required: true }), mimeType: t.string({ required: true }), httpMethod: t.field({ type: HttpMethod, defaultValue: 'PUT' }), fileSize: t.field({ type: 'UnsignedInt64' }) }),
});
const Param = builder.objectRef<{ name: string; value: string }>('StagedUploadParameter').implement({ fields: (t) => ({ name: t.exposeString('name'), value: t.exposeString('value') }) });
const Target = builder.objectRef<{ url: string; resourceUrl: string; parameters: { name: string; value: string }[] }>('StagedMediaUploadTarget').implement({
  fields: (t) => ({ url: t.exposeString('url', { nullable: true }), resourceUrl: t.exposeString('resourceUrl', { nullable: true }), parameters: t.field({ type: [Param], resolve: (x) => x.parameters }) }),
});
const StagedPayload = definePayload<{ stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[] | null }>('StagedUploadsCreatePayload', (t) => ({
  stagedTargets: t.field({ type: [Target], nullable: true, resolve: (p) => p.stagedTargets }),
}));

/** Signed, expiring upload token: `<base64url payload>.<hmac>`. Verified by `PUT|POST /admin/api/staged/:token`. */
export function signStagedToken(secret: string, payload: { s: number; k: string; f: string; m: string; e: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

builder.mutationFields((t) => ({
  fileUpdate: t.field({
    type: FileUpdatePayload, args: { files: t.arg({ type: [FileUpdateInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_files');
      const updates = [];
      for (const [i, f] of a.files.entries()) {
        const id = mediaId(String(f.id));
        if (!id) return { files: null, userErrors: [{ field: ['files', String(i), 'id'], message: 'File does not exist', code: 'FILE_DOES_NOT_EXIST' }] };
        updates.push({ id, alt: f.alt, originalSource: f.originalSource, focalPoint: f.focalPoint });
      }
      const r = await updateFiles(ctx.db, ctx.shopId, updates);
      return r.ok ? { files: r.value, userErrors: [] } : { files: null, userErrors: r.errors };
    },
  }),
  fileDelete: t.field({
    type: FileDeletePayload, args: { fileIds: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_files');
      const ids = a.fileIds.map((x) => mediaId(String(x)));
      const bad = ids.findIndex((x) => x == null);
      if (bad >= 0) return { deletedFileIds: null, userErrors: [{ field: ['fileIds', String(bad)], message: 'File does not exist', code: 'FILE_DOES_NOT_EXIST' }] };
      const gids = a.fileIds.map(String);
      const r = await deleteFiles(ctx.db, ctx.shopId, ids as number[]);
      return r.ok ? { deletedFileIds: gids, userErrors: [] } : { deletedFileIds: null, userErrors: r.errors };
    },
  }),
  stagedUploadsCreate: t.field({
    type: StagedPayload, args: { input: t.arg({ type: [StagedUploadInput], required: true }) },
    resolve: (_r, { input }, ctx) => {
      requireScope(ctx, 'write_files');
      const base = ctx.storeUrl;
      const targets = input.map((i) => {
        // Bulk mutation variables are private to the shop and never listed as files; every target also carries its storage `key` (the `stagedUploadPath` of bulk mutations).
        const key = i.resource === 'BULK_MUTATION_VARIABLES' ? `tmp/${ctx.shopId}/bulk/${randomToken(12)}/${makeStorageKey(i.filename).split('/').pop()}` : makeStorageKey(i.filename);
        const token = signStagedToken(ctx.app.config.sessionSecret, { s: ctx.shopId, k: key, f: i.filename, m: i.mimeType, e: Date.now() + 3600_000 });
        return { url: `${ctx.app.config.appUrl}/admin/api/staged/${token}`, resourceUrl: `${base}${ctx.app.storageFor(ctx.shopId).url(key)}`, parameters: [{ name: 'content_type', value: i.mimeType }, { name: 'filename', value: i.filename }, { name: 'key', value: key }] };
      });
      return { stagedTargets: targets, userErrors: [] };
    },
  }),
}));
