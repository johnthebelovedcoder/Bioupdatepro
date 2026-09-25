import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/current-user.decorator';

/**
 * Is the API up, and can it reach its database?
 *
 * Two different questions with one answer each, so an outage says which
 * half is down. On 2026-09-24 the API was up for hours while every request
 * failed because its database was unreachable; the only symptom anyone saw
 * was a bare "Internal server error" at sign-in.
 *
 * Always 200 while the process is serving — this is also the platform's
 * health check, and restarting a healthy API because its database is
 * briefly away would only add an outage. `status` says whether it is fully
 * working.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    const started = Date.now();
    let database: 'up' | 'down' = 'down';
    let detail: string | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 5s')), 5000)),
      ]);
      database = 'up';
    } catch (error) {
      // The first line only: enough to tell "unreachable" from "timed out",
      // without handing a stack trace or connection string to the world.
      // Prisma leads with "Invalid `…` invocation:"; the reason is further down.
      const lines = (error instanceof Error ? error.message : String(error)).split('\n').map((l) => l.trim()).filter(Boolean);
      detail = (lines.find((l) => !l.startsWith('Invalid')) ?? lines[0])?.slice(0, 160);
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      api: 'up',
      database,
      ...(detail ? { detail } : {}),
      checkedInMs: Date.now() - started,
      time: new Date().toISOString(),
    };
  }
}
