import { describe, expect, it } from 'vitest';
import { shouldUseEmbeddedPostgres, waitForDatabaseReady } from '../global-setup';

describe('global setup database selection', () => {
  it('prefers the embedded test database for the repo default local dev URL', () => {
    const url = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres?connection_limit=1&sslmode=disable&pgbouncer=true';
    expect(shouldUseEmbeddedPostgres(url)).toBe(true);
  });

  it('keeps a real configured external database when it is not the local dev default', () => {
    const url = 'postgresql://app:secret@prod-db.example.com:5432/bioassetpro';
    expect(shouldUseEmbeddedPostgres(url)).toBe(false);
  });

  it('retries until the Postgres instance is actually accepting connections', async () => {
    let attempts = 0;

    await expect(
      waitForDatabaseReady(async () => {
        attempts += 1;
        return attempts >= 3;
      }, 100, 1),
    ).resolves.toBeUndefined();

    expect(attempts).toBeGreaterThanOrEqual(3);
  });
});
