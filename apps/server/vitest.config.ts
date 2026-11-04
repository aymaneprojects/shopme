import { defineConfig } from 'vitest/config';

// Test files boot an embedded database and migrate it in beforeAll; under a parallel turbo run on a busy machine the
// default 10 s hook timeout is flaky.
export default defineConfig({ test: { hookTimeout: 120_000, testTimeout: 60_000 } });
