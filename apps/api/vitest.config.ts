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
    // Fixture provisioning can exceed the default on a long serial run. Vitest
    // does not cancel an async hook on timeout, so a false timeout can leave
    // database setup running into the next test's reset.
    hookTimeout: 300_000,
  },
  esbuild: {
    target: 'es2022',
  },
});
