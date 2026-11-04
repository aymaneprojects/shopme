import type { FastifyInstance } from 'fastify';

/** Checkout mount point (/checkout/*, payment webhooks). The checkout/payments agent fills this in. */
export async function registerCheckout(app: FastifyInstance): Promise<void> {
  app.get('/checkout', async (_req, reply) => reply.code(501).send({ error: 'Checkout is not implemented yet' }));
}
