import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

// Test files boot an embedded database and migrate it in beforeAll; under a parallel turbo run on a busy machine the
// default 10 s hook timeout is flaky.
// `graphql` is pinned to its CommonJS entry: otherwise vite resolves the ES module build for our sources while Pothos and Yoga
// (loaded by Node) use the CommonJS one, and `instanceof` checks between the two copies fail in code that walks the schema.
export default defineConfig({
  resolve: { alias: { graphql: require.resolve('graphql') } },
  test: { hookTimeout: 120_000, testTimeout: 60_000 },
});
