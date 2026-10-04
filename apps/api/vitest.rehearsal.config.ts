import { defineConfig } from 'vitest/config';

/**
 * The balance-cutover rehearsal (test/rehearsal): runs against a restored copy
 * of a database named by DATABASE_URL, never against a throwaway one. Not part
 * of `npm test`. See docs/cutover-rehearsal-2026-10-04.md.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/rehearsal/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  esbuild: { target: 'es2022' },
});
