import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { ANY_ROLE_KEY, ROLES_KEY, RolesGuard } from '../../src/auth/roles.guard';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * UAT-001: only assigned actions are reachable; a restricted-screen attempt is
 * blocked AND logged (Role_RACI_KPI, SYSTEM_INTEGRITY_MATRIX).
 */

let prisma: PrismaService;
let guard: RolesGuard;
let fixture: TestFixture;

/** A request for one route, as the guard sees it. */
function contextFor(user: { userId: string; roles: string[] } | null, roles: string[] | null, open = false): ExecutionContext {
  const handler = () => undefined;
  if (roles) Reflect.defineMetadata(ROLES_KEY, roles, handler);
  if (open) Reflect.defineMetadata(ANY_ROLE_KEY, 'test', handler);
  const request = {
    method: 'POST',
    path: '/api/workflow/settings/self-approval',
    route: { path: '/api/workflow/settings/self-approval' },
    ip: '127.0.0.1',
    user: user ? { ...user, email: 'x@test', fullName: 'X', companyId: fixture.companyId } : undefined,
  };
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

beforeAll(() => {
  prisma = new PrismaService();
  // The guard reads its decisions through the Reflector, keyed as the decorators write them.
  const reflector = new Reflector();
  guard = new RolesGuard(reflector, new AuditService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

async function refusalsFor(userId: string) {
  for (let i = 0; i < 40; i++) {
    const rows = await prisma.auditRecord.findMany({ where: { userId, status: 'ACCESS_DENIED' } });
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

describe('Role access (UAT-001)', () => {
  it('lets a role through to what it is assigned', () => {
    expect(guard.canActivate(contextFor({ userId: fixture.makerId, roles: ['CFO'] }, ['CFO']))).toBe(true);
  });

  it('blocks a restricted action and logs the attempt: who, what, and the roles it needed', async () => {
    expect(() => guard.canActivate(contextFor({ userId: fixture.makerId, roles: ['FARM_ATTENDANT'] }, ['CFO']))).toThrow(ForbiddenException);

    const [attempt] = await refusalsFor(fixture.makerId);
    expect(attempt).toBeDefined();
    expect(attempt).toMatchObject({ module: 'auth', entityId: 'POST /api/workflow/settings/self-approval', action: 'REJECT' });
    expect(attempt!.metadata).toMatchObject({ needed: ['CFO'], held: ['FARM_ATTENDANT'] });
  });

  it('refuses a route nobody has said who may use (deny by default)', () => {
    expect(() => guard.canActivate(contextFor({ userId: fixture.makerId, roles: ['CFO'] }, null))).toThrow(/no access rule/);
  });
});
