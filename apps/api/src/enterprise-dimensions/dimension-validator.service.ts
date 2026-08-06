import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MissingDimensionError } from '../common/errors';
import {
  DIMENSION_LABELS,
  EnterpriseDimensions,
  MANDATORY_DIMENSION_KEYS,
} from './dimensions.types';

export interface DimensionValidationTarget {
  lineNumber: number;
  glAccountId: string;
  dimensions: EnterpriseDimensions;
}

/**
 * The single place that decides whether a GL line carries the dimensions it
 * needs. Consolidated Reference §1.1.
 *
 * Two tiers:
 *
 *   1. The mandatory six are non-negotiable and are also NOT NULL in the
 *      database. This check exists to produce a readable error before the
 *      database produces an unreadable one.
 *
 *   2. Conditional dimensions are driven by the `requires*` flags on the GL
 *      account — configuration rows, not code (Rule 8). Making cost centre
 *      mandatory for WIP is an admin action, not a deployment.
 *
 * Referential integrity is checked here too: a dimension must exist, be active,
 * and belong to the company being posted to. Foreign keys alone would let a
 * caller post Company A's journal against Company B's cost centre.
 */
@Injectable()
export class DimensionValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(targets: DimensionValidationTarget[]): Promise<void> {
    for (const target of targets) {
      this.assertMandatoryPresent(target);
    }
    await this.assertConditionalPresent(targets);
    await this.assertReferencesResolve(targets);
  }

  private assertMandatoryPresent(target: DimensionValidationTarget): void {
    for (const key of MANDATORY_DIMENSION_KEYS) {
      const value = target.dimensions[key];
      if (value === undefined || value === null || value === '') {
        throw new MissingDimensionError(
          DIMENSION_LABELS[key] ?? key,
          'mandatory on every GL-posting transaction (§1.1)',
          target.lineNumber,
        );
      }
    }
  }

  private async assertConditionalPresent(
    targets: DimensionValidationTarget[],
  ): Promise<void> {
    const accountIds = [...new Set(targets.map((t) => t.glAccountId))];
    const accounts = await this.prisma.gLAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        accountNumber: true,
        name: true,
        active: true,
        isPostingAccount: true,
        requiresCostCentre: true,
        requiresDepartment: true,
        requiresFarm: true,
        requiresProject: true,
      },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    for (const target of targets) {
      const account = byId.get(target.glAccountId);
      if (!account) {
        throw new MissingDimensionError(
          'GL Account',
          `account ${target.glAccountId} does not exist`,
          target.lineNumber,
        );
      }
      if (!account.active) {
        throw new MissingDimensionError(
          'GL Account',
          `account ${account.accountNumber} (${account.name}) is inactive`,
          target.lineNumber,
        );
      }
      // Summary accounts exist for reporting rollup. Posting to one would make
      // the hierarchy double-count.
      if (!account.isPostingAccount) {
        throw new MissingDimensionError(
          'GL Account',
          `account ${account.accountNumber} (${account.name}) is a summary account and cannot be posted to`,
          target.lineNumber,
        );
      }

      const conditionals: [boolean, keyof EnterpriseDimensions][] = [
        [account.requiresCostCentre, 'costCentreId'],
        [account.requiresDepartment, 'departmentId'],
        [account.requiresFarm, 'farmId'],
        [account.requiresProject, 'projectId'],
      ];

      for (const [required, key] of conditionals) {
        if (required && !target.dimensions[key]) {
          throw new MissingDimensionError(
            DIMENSION_LABELS[key] ?? key,
            `account ${account.accountNumber} (${account.name}) is configured to require it`,
            target.lineNumber,
          );
        }
      }
    }
  }

  /**
   * Every supplied dimension must exist, be active, and belong to the company
   * being posted to. Without the company check, foreign keys would happily
   * accept another company's cost centre.
   */
  private async assertReferencesResolve(
    targets: DimensionValidationTarget[],
  ): Promise<void> {
    if (targets.length === 0) return;

    const companyIds = [...new Set(targets.map((t) => t.dimensions.companyId))];
    if (companyIds.length > 1) {
      throw new MissingDimensionError(
        'Company',
        `a single journal cannot span companies (found ${companyIds.join(', ')})`,
      );
    }
    const companyId = companyIds[0] as string;

    const collect = (key: keyof EnterpriseDimensions): string[] => [
      ...new Set(
        targets
          .map((t) => t.dimensions[key])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ];

    const branchIds = collect('branchId');
    const departmentIds = collect('departmentId');
    const costCentreIds = collect('costCentreId');
    const farmIds = collect('farmId');
    const penHouseIds = collect('penHouseId');
    const projectIds = collect('projectId');

    const [branches, departments, costCentres, farms, penHouses, projects] =
      await Promise.all([
        this.prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        this.prisma.department.findMany({
          where: { id: { in: departmentIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        this.prisma.costCentre.findMany({
          where: { id: { in: costCentreIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        this.prisma.farm.findMany({
          where: { id: { in: farmIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        this.prisma.penHouse.findMany({
          where: { id: { in: penHouseIds } },
          select: {
            id: true,
            active: true,
            code: true,
            farm: { select: { companyId: true } },
          },
        }),
        this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
      ]);

    const check = (
      label: string,
      requested: string[],
      found: { id: string; companyId: string; active: boolean; code: string }[],
    ) => {
      const byId = new Map(found.map((f) => [f.id, f]));
      for (const id of requested) {
        const row = byId.get(id);
        if (!row) {
          throw new MissingDimensionError(label, `"${id}" does not exist`);
        }
        if (!row.active) {
          throw new MissingDimensionError(
            label,
            `"${row.code}" is inactive and cannot be posted to`,
          );
        }
        if (row.companyId !== companyId) {
          throw new MissingDimensionError(
            label,
            `"${row.code}" belongs to another company`,
          );
        }
      }
    };

    check('Branch', branchIds, branches);
    check('Department', departmentIds, departments);
    check('Cost Centre', costCentreIds, costCentres);
    check('Farm', farmIds, farms);
    check('Project', projectIds, projects);
    check(
      'Pen/House',
      penHouseIds,
      penHouses.map((p) => ({
        id: p.id,
        companyId: p.farm.companyId,
        active: p.active,
        code: p.code,
      })),
    );
  }
}
