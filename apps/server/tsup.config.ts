import { defineConfig } from 'tsup';

// Workspace packages (@shopme/*) are bundled; npm dependencies listed in package.json stay external.
export default defineConfig({
  entry: ['src/main.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: [/^@shopme\//],
});
