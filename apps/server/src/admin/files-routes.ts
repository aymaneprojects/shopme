import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MAX_UPLOAD_BYTES, schema, saveUpload } from '@shopme/core';
import { authenticate } from '../plugins/auth';

/** `POST /admin/api/files` (multipart, field "file") -> `{ file: { id, filename, url, mimeType, byteSize } }`. */
export function registerFileUploadRoute(app: FastifyInstance) {
  app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    scope.post('/admin/api/files', async (req, reply) => {
      const auth = await authenticate(req);
      if (!auth) return reply.code(401).send({ error: 'Not authenticated' });
      const part = await req.file();
      if (!part) return reply.code(400).send({ error: 'No file uploaded' });
      const data = await part.toBuffer();
      if (part.file.truncated) return reply.code(413).send({ error: 'File too large' });
      const row = await saveUpload(app.ctx.db, app.ctx.storageFor(auth.shopId), auth.shopId, { filename: part.filename || 'upload', data, mimeType: part.mimetype });
      return reply.code(201).send({ file: { id: row.id, filename: row.filename, url: row.url, mimeType: row.mimeType, byteSize: row.byteSize } });
    });

    // Staged upload targets (`stagedUploadsCreate`): the signed token in the URL is the credential. PUT with the raw body, or POST multipart (field "file").
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
    const staged = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      const token = (req.params as { token: string }).token;
      const [body, sig] = token.split('.');
      const good = createHmac('sha256', app.ctx.config.sessionSecret).update(body ?? '').digest('base64url');
      if (!body || !sig || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return reply.code(403).send({ error: 'Invalid upload token' });
      const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { s: number; k: string; f: string; m: string; e: number };
      if (p.e < Date.now()) return reply.code(403).send({ error: 'Upload token expired' });
      let data: Buffer;
      if (req.isMultipart()) { const part = await req.file(); if (!part) return reply.code(400).send({ error: 'No file uploaded' }); data = await part.toBuffer(); } else data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || !data.length) return reply.code(400).send({ error: 'Empty upload' });
      await app.ctx.storageFor(p.s).put(p.k, data);
      // Private staging area (bulk mutation variables): stored but not registered as a file of the shop.
      if (p.k.startsWith('tmp/')) return reply.code(201).send({ file: { id: null, filename: p.f, url: app.ctx.storageFor(p.s).url(p.k), mimeType: p.m, byteSize: data.length } });
      const [row] = await app.ctx.db.insert(schema.files).values({ shopId: p.s, filename: p.f.slice(0, 255), storageKey: p.k, mimeType: p.m, byteSize: data.length }).onConflictDoNothing().returning();
      return reply.code(201).send({ file: { id: row?.id ?? null, filename: p.f, url: app.ctx.storageFor(p.s).url(p.k), mimeType: p.m, byteSize: data.length } });
    };
    scope.put('/admin/api/staged/:token', staged);
    scope.post('/admin/api/staged/:token', staged);
  });
}
