import type { FastifyInstance } from 'fastify';
import { labelDocument } from '@shopme/core';
import { authenticate } from '../plugins/auth';

/**
 * `GET /admin/api/shipping-labels/:id/label` (staff, scope `read_orders`): the stored document of a label bought from a carrier account, to
 * print. It holds the customer's address, so it is never public and never cached.
 */
export function registerLabelRoutes(app: FastifyInstance) {
  app.get('/admin/api/shipping-labels/:id/label', async (req, reply) => {
    const auth = await authenticate(req);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });
    if (!auth.scopes.some((s) => s === '*' || s === 'read_orders' || s === 'write_orders' || s === 'write_fulfillments')) return reply.code(403).send({ error: 'Access denied. Required access: read_orders' });
    const id = Number((req.params as { id: string }).id);
    const doc = Number.isSafeInteger(id) && id > 0 ? await labelDocument(app.ctx.db, auth.shopId, id) : null;
    if (!doc) return reply.code(404).send({ error: 'Label document not found' });
    const ext = doc.contentType === 'application/pdf' ? 'pdf' : doc.contentType === 'image/png' ? 'png' : 'zpl';
    const name = `label-${doc.label.trackingNumber ?? doc.label.id}`.replace(/[^A-Za-z0-9_-]/g, '');
    return reply.header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').header('content-disposition', `inline; filename="${name}.${ext}"`).type(doc.contentType).send(doc.data);
  });
}
