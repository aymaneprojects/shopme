import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../../../src/admin/graphql/schema';
import { createTestApp, setupAndLogin, type TestApp } from '../../../src/test-utils';
import { assertShape, buildSelection, loadFixture, makeGql, makeGqlOk } from '../helpers';
import { seedCatalog } from '../seed';
import { seedCustomer, seedOrder, shopIdOf } from '../seed-sales';

/** Orders and customers against the recorded shapes (paths and GraphQL types only). */
describe('admin orders and customers response shapes', () => {
  let t: TestApp;
  let g: ReturnType<typeof makeGqlOk>;
  beforeAll(async () => {
    t = await createTestApp();
    g = makeGqlOk(makeGql(t.app, await setupAndLogin(t.app)));
    const db = t.dbHandle.db;
    const shopId = await shopIdOf(db);
    const c = await seedCustomer(db, shopId);
    const cat = await seedCatalog(g);
    const num = (gid: string) => Number(gid.split('/').pop());
    await seedOrder(db, shopId, 1, { customerId: c.id, tags: ['gift'], productId: num(cat.minimal.id), variantId: num(cat.minimalVariant.id) });
  }, 120_000);
  afterAll(async () => { await t.close(); });

  for (const name of ['orders', 'customers']) {
    it(`${name} match the recorded shape`, async () => {
      const fx = loadFixture(name);
      const data = await g(`{ ${fx.root}(first: 10) { nodes { ${buildSelection(schema, fx)} } } }`);
      const nodes = data[fx.root].nodes as unknown[];
      expect(nodes.length).toBeGreaterThan(0);
      assertShape(schema, fx, nodes);
    });
  }
});
