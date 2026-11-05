import { createMediaRows, fileMeta, getFolder, getMedia, type FileMeta, type Folder, type Media } from '@shopme/core';
import type { GraphQLContext } from '../context';
import { builder } from '../builder';
import { requireScope } from '../context';
import { Node, registerNode } from '../types/node';
import { File_, Media_, absUrl, defineTypedPayload } from '../types/catalog';

/** Admin image shape. `id` is nullable like the real `Image.id`. */
interface ImageShape { id: string | null; url: string; altText: string | null; width: number | null; height: number | null }
export const imageOf = (ctx: GraphQLContext, m: Media): ImageShape => ({ id: `gid://shopify/ImageSource/${m.id}`, url: absUrl(ctx, m.url) ?? '', altText: m.alt, width: m.width, height: m.height });

const ImageTransformInput = builder.inputType('ImageTransformInput', {
  fields: (t) => ({ maxWidth: t.int(), maxHeight: t.int(), scale: t.int({ defaultValue: 1 }), preferredContentType: t.string() }),
});
export const Image = builder.objectRef<ImageShape>('Image').implement({
  fields: (t) => ({
    id: t.exposeID('id', { nullable: true }),
    url: t.field({ type: 'URL', args: { transform: t.arg({ type: ImageTransformInput }) }, resolve: (i) => i.url }),
    altText: t.exposeString('altText', { nullable: true }),
    width: t.exposeInt('width', { nullable: true }),
    height: t.exposeInt('height', { nullable: true }),
  }),
});

export const MediaContentType = builder.enumType('MediaContentType', { values: ['VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D', 'IMAGE'] as const });
const MediaStatus = builder.enumType('MediaStatus', { values: ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'] as const });
const FileStatus = builder.enumType('FileStatus', { values: ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'] as const });
const MediaPreviewImageStatus = builder.enumType('MediaPreviewImageStatus', { values: ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'] as const });
const MediaPreviewImage = builder.objectRef<Media & { ctx: GraphQLContext }>('MediaPreviewImage').implement({
  fields: (t) => ({
    image: t.field({ type: Image, nullable: true, resolve: (m) => imageOf(m.ctx, m) }),
    status: t.field({ type: MediaPreviewImageStatus, resolve: (m) => m.status as 'READY' }),
  }),
});

const TYPE_NAMES: Record<string, string> = { IMAGE: 'MediaImage', VIDEO: 'Video', EXTERNAL_VIDEO: 'ExternalVideo', MODEL_3D: 'Model3d' };
const resolveType = (m: Media) => TYPE_NAMES[m.type] ?? 'MediaImage';

Media_.implement({
  interfaces: [Node],
  resolveType,
  fields: (t) => ({
    alt: t.exposeString('alt', { nullable: true }),
    mediaContentType: t.field({ type: MediaContentType, resolve: (m) => m.type as 'IMAGE' }),
    status: t.field({ type: MediaStatus, resolve: (m) => m.status as 'READY' }),
    preview: t.field({ type: MediaPreviewImage, nullable: true, resolve: (m, _a, ctx) => ({ ...m, ctx }) }),
  }),
});
/** ShopMe extensions on files: stored name and size, where the file is used, and its folder. */
const metaCache = new WeakMap<Media, FileMeta>();
export const cacheFileMeta = (rows: Media[], meta: Map<number, FileMeta>) => { for (const r of rows) { const m = meta.get(r.id); if (m) metaCache.set(r, m); } };
const metaOf = async (ctx: GraphQLContext, m: Media): Promise<FileMeta> => metaCache.get(m) ?? (await fileMeta(ctx.db, ctx.shopId, [m])).get(m.id)!;
const FileReference = builder.objectRef<{ type: string; id: number | null; title: string }>('ShopmeFileReference').implement({
  fields: (t) => ({ type: t.exposeString('type'), id: t.string({ nullable: true, resolve: (r) => (r.id == null ? null : String(r.id)) }), title: t.exposeString('title') }),
});
export const FileFolder = builder.objectRef<Folder & { fileCount?: number }>('ShopmeFileFolder');
FileFolder.implement({
  fields: (t) => ({
    id: t.id({ resolve: (f) => `gid://shopme/FileFolder/${f.id}` }), name: t.exposeString('name'),
    fileCount: t.int({ nullable: true, resolve: (f) => f.fileCount ?? null }), createdAt: t.field({ type: 'DateTime', resolve: (f) => f.createdAt }),
  }),
});

File_.implement({
  interfaces: [Node],
  resolveType,
  fields: (t) => ({
    shopmeFilename: t.string({ nullable: true, resolve: async (m, _a, ctx) => (await metaOf(ctx, m)).filename }),
    shopmeFileSize: t.int({ nullable: true, resolve: async (m, _a, ctx) => (await metaOf(ctx, m)).byteSize }),
    shopmeReferences: t.field({ type: [FileReference], resolve: async (m, _a, ctx) => (await metaOf(ctx, m)).references }),
    shopmeFolder: t.field({ type: FileFolder, nullable: true, resolve: async (m, _a, ctx) => (m.folderId ? getFolder(ctx.db, ctx.shopId, m.folderId) : null) }),
    alt: t.exposeString('alt', { nullable: true }),
    fileStatus: t.field({ type: FileStatus, resolve: (m) => m.status as 'READY' }),
    createdAt: t.field({ type: 'DateTime', resolve: (m) => m.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (m) => m.updatedAt }),
    preview: t.field({ type: MediaPreviewImage, nullable: true, resolve: (m, _a, ctx) => ({ ...m, ctx }) }),
  }),
});

const OriginalSource = builder.objectRef<{ url: string; fileSize: number | null }>('MediaImageOriginalSource').implement({
  fields: (t) => ({ url: t.field({ type: 'URL', resolve: (o) => o.url }), fileSize: t.int({ nullable: true, resolve: (o) => o.fileSize }) }),
});
export const MediaImage = builder.objectRef<Media>('MediaImage').implement({
  interfaces: [Media_, File_, Node],
  fields: (t) => ({
    createdAt: t.field({ type: 'DateTime', resolve: (m) => m.createdAt }),
    updatedAt: t.field({ type: 'DateTime', resolve: (m) => m.updatedAt }),
    mimeType: t.exposeString('mimeType', { nullable: true }),
    image: t.field({ type: Image, nullable: true, resolve: (m, _a, ctx) => imageOf(ctx, m) }),
    originalSource: t.field({ type: OriginalSource, nullable: true, resolve: async (m, _a, ctx) => ({ url: absUrl(ctx, m.url) ?? '', fileSize: (await metaOf(ctx, m)).byteSize }) }),
  }),
});
for (const name of ['Video', 'ExternalVideo', 'Model3d']) {
  builder.objectRef<Media>(name).implement({
    interfaces: [Media_, File_, Node],
    fields: (t) => ({ createdAt: t.field({ type: 'DateTime', resolve: (m) => m.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (m) => m.updatedAt }) }),
  });
}
for (const [type, name] of Object.entries(TYPE_NAMES)) {
  registerNode(name, async (ctx, id) => {
    const m = await getMedia(ctx.db, ctx.shopId, id);
    return m && m.type === type ? m : null;
  });
}

/* ------------------------------ mutations ------------------------------ */

export const CreateMediaInput = builder.inputType('CreateMediaInput', {
  fields: (t) => ({ originalSource: t.string({ required: true }), alt: t.string(), mediaContentType: t.field({ type: MediaContentType, required: true }) }),
});
const FileContentType = builder.enumType('FileContentType', { values: ['IMAGE', 'FILE', 'VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D'] as const });
const DuplicateMode = builder.enumType('FileCreateInputDuplicateResolutionMode', { values: ['APPEND_UUID', 'RAISE_ERROR', 'REPLACE'] as const });
const FileCreateInput = builder.inputType('FileCreateInput', {
  fields: (t) => ({
    filename: t.string(), contentType: t.field({ type: FileContentType }), alt: t.string(),
    duplicateResolutionMode: t.field({ type: DuplicateMode, defaultValue: 'APPEND_UUID' }), originalSource: t.string({ required: true }),
  }),
});
const FileCreatePayload = defineTypedPayload<{ files: Media[] | null }>('FileCreatePayload', 'FilesUserError', (t) => ({
  files: t.field({ type: [File_], nullable: true, resolve: (p) => p.files }),
}));

builder.mutationFields((t) => ({
  fileCreate: t.field({
    type: FileCreatePayload, args: { files: t.arg({ type: [FileCreateInput], required: true }) },
    resolve: async (_r, { files }, ctx) => {
      requireScope(ctx, 'write_files');
      const unsupported = files.findIndex((f) => f.contentType === 'FILE');
      if (unsupported >= 0) return { files: null, userErrors: [{ field: ['files', String(unsupported), 'contentType'], message: 'Only media files (images, videos, 3D models) are supported', code: 'INVALID' }] };
      const r = await ctx.db.transaction(async (tx) => createMediaRows(tx, ctx.shopId, files.map((f) => ({ originalSource: f.originalSource, alt: f.alt, mediaContentType: f.contentType ?? 'IMAGE' })), 'files'));
      return r.ok ? { files: r.value, userErrors: [] } : { files: null, userErrors: r.errors.map((e) => ({ ...e, code: 'INVALID' })) };
    },
  }),
}));
