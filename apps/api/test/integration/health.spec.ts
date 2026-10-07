import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { HealthController } from '../../src/common/health.controller';

/** The health check says which build is serving and how far its schema has got. */
describe('Health check', () => {
  let prisma: PrismaService;
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });
  afterAll(async () => {
    delete process.env.RENDER_GIT_COMMIT;
    await prisma.$disconnect();
  });

  it('reports the commit it was built from and the newest migration applied', async () => {
    process.env.RENDER_GIT_COMMIT = 'b22c220be8a315d93eaa0eb159272c738205efa0';
    const result = await new HealthController(prisma).health();
    expect(result.status).toBe('ok');
    expect(result.version).toBe('b22c220');
    expect(result.migration).toMatch(/^\d{4}_/);
  });

  it('says so when it cannot tell which commit it is', async () => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.GIT_COMMIT;
    expect((await new HealthController(prisma).health()).version).toBe('unknown');
  });
});
