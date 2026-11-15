import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertCanGrantRoles, assignableRoleCodes, ROLE_CATALOGUE } from '../../src/auth/role-assignment.policy';

describe('role assignment policy', () => {
  it('offers the complete supported role catalogue', () => {
    expect(ROLE_CATALOGUE).toHaveLength(24);
    expect(new Set(ROLE_CATALOGUE.map(({ code }) => code)).size).toBe(ROLE_CATALOGUE.length);
  });

  it('allows administrators all roles, but reserves Administrator grants to them', () => {
    expect(assignableRoleCodes(['ADMINISTRATOR'])).toEqual(
      ROLE_CATALOGUE.map(({ code }) => code),
    );
    expect(assignableRoleCodes(['CFO'])).not.toContain('ADMINISTRATOR');
    expect(() => assertCanGrantRoles(['CFO'], ['ADMINISTRATOR'])).toThrow(ForbiddenException);
  });

  it('limits Farm Managers to farm-operation roles', () => {
    const assignable = assignableRoleCodes(['FARM_MANAGER']);
    expect(assignable).toContain('FARM_ATTENDANT');
    expect(assignable).toContain('STOREKEEPER');
    expect(assignable).not.toContain('FINANCE_MANAGER');
    expect(assignable).not.toContain('QA_OFFICER');
    expect(() => assertCanGrantRoles(['FARM_MANAGER'], ['FINANCE_MANAGER'])).toThrow(
      ForbiddenException,
    );
  });

  it('limits System Administrators to non-finance, non-approval roles', () => {
    const assignable = assignableRoleCodes(['SYSTEM_ADMIN']);
    expect(assignable).toContain('SYSTEM_ADMIN');
    expect(assignable).toContain('QA_OFFICER');
    expect(assignable).not.toContain('CFO');
    expect(assignable).not.toContain('FINANCE_MANAGER');
    expect(assignable).not.toContain('HR_MANAGER');
  });

  it('allows an editor to retain or remove an existing role without granting it anew', () => {
    expect(() =>
      assertCanGrantRoles(['FARM_MANAGER'], ['FARM_MANAGER', 'FINANCE_MANAGER'], [
        'FARM_MANAGER',
        'FINANCE_MANAGER',
      ]),
    ).not.toThrow();
    expect(() =>
      assertCanGrantRoles(['FARM_MANAGER'], ['FARM_MANAGER', 'FINANCE_MANAGER'], ['FARM_MANAGER']),
    ).toThrow(ForbiddenException);
  });

  it('rejects role codes that are not in the supported catalogue', () => {
    expect(() => assertCanGrantRoles(['ADMINISTRATOR'], ['MADE_UP_ROLE'])).toThrow(
      BadRequestException,
    );
  });
});
