import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { MAX_UPLOAD_BYTES, saveUpload } from '@shopme/core';
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
      const row = await saveUpload(app.ctx.db, app.ctx.storage, auth.shopId, { filename: part.filename || 'upload', data, mimeType: part.mimetype });
      return reply.code(201).send({ file: { id: row.id, filename: row.filename, url: row.url, mimeType: row.mimeType, byteSize: row.byteSize } });
    });
  });
}
