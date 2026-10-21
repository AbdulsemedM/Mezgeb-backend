import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC keeps the decorator metadata Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    // Tests run against the shared package's source, so no build step is needed first.
    alias: {
      '@mezgeb/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/setup/global-setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
