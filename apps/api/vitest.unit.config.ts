import { defineConfig } from 'vitest/config';

/**
 * Unit suite: pure logic, no database, no global setup.
 *
 * Kept separate from the integration suite so the money invariants can be
 * verified in a second, on any machine, without a Postgres anywhere in sight.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/unit/**/*.spec.ts'],
  },
  esbuild: { target: 'es2022' },
});
