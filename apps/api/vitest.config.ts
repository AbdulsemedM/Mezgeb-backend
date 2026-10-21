import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC keeps the decorator metadata Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
