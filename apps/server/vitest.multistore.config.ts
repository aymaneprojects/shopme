import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The whole server suite with the installation in multi-store mode (`pnpm --filter @shopme/server test:multi`): every test
// runs against the first store on its own host (`<handle>.shops.test`), the admin on the platform host (see test-utils).
export default mergeConfig(base, defineConfig({ test: { env: { MULTI_STORE: 'true' } } }));
