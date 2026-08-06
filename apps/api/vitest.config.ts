import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database. Running files in parallel would let
    // one file's reset truncate another file's fixture mid-test.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  esbuild: {
    target: 'es2022',
  },
});
