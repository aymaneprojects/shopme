import type { FastifyInstance } from 'fastify';

/**
 * Webhooks mount point: inbound provider webhooks (e.g. /webhooks/stripe) and the outbound delivery
 * worker (webhook_subscriptions / webhook_deliveries tables, run through app.ctx.queue).
 */
export async function registerWebhooks(_app: FastifyInstance): Promise<void> {}
