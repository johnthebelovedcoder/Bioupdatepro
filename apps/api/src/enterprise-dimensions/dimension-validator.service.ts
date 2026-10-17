import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
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
  /** Approved system/subledger event; manual journals never set this. */
  allowControlAccount?: boolean;
  sourceDocumentId?: string | null;
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

  async validate(
    targets: DimensionValidationTarget[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    for (const target of targets) {
      this.assertMandatoryPresent(target);
    }
    await this.assertConditionalPresent(targets, tx);
    await this.assertReferencesResolve(targets, tx);
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
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const accountIds = [...new Set(targets.map((t) => t.glAccountId))];
    const accounts = await db.gLAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        companyId: true,
        accountNumber: true,
        name: true,
        active: true,
        isPostingAccount: true,
        isControlAccount: true,
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
      // The same rule every other dimension gets below. Until 2026-09-25 an
      // account was only checked to exist, so a journal could name another
      // company's account by id and post to it.
      if (account.companyId !== target.dimensions.companyId) {
        throw new MissingDimensionError(
          'GL Account',
          `account ${target.glAccountId} belongs to another company`,
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
      if (!account.isPostingAccount && !(target.allowControlAccount && account.isControlAccount)) {
        throw new MissingDimensionError(
          'GL Account',
          `account ${account.accountNumber} (${account.name}) is a summary account or a control account without an approved system/subledger posting route`,
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

      if (['219830', '54300'].includes(account.accountNumber)) {
        if (!target.sourceDocumentId) {
          throw new MissingDimensionError('Batch / source document', `Feed Mill recovery account ${account.accountNumber} must link to its production order`, target.lineNumber);
        }
        for (const key of ['speciesKey', 'itemId', 'costCentreId'] as const) {
          if (!target.dimensions[key]) {
            throw new MissingDimensionError(
              DIMENSION_LABELS[key] ?? key,
              `Feed Mill recovery account ${account.accountNumber} requires species, formula, batch work centre and source-order analysis`,
              target.lineNumber,
            );
          }
        }
        if (!['snail', 'poultry'].includes(target.dimensions.speciesKey ?? '')) {
          throw new MissingDimensionError('Species', 'Feed Mill recovery supports snail or poultry feed only', target.lineNumber);
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
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
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
        db.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        db.department.findMany({
          where: { id: { in: departmentIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        db.costCentre.findMany({
          where: { id: { in: costCentreIds } },
          select: { id: true, companyId: true, active: true, code: true, postingAllowed: true, approvedApplication: true },
        }),
        db.farm.findMany({
          where: { id: { in: farmIds } },
          select: { id: true, companyId: true, active: true, code: true },
        }),
        db.penHouse.findMany({
          where: { id: { in: penHouseIds } },
          select: {
            id: true,
            active: true,
            code: true,
            farm: { select: { companyId: true } },
          },
        }),
        db.project.findMany({
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
    for (const centre of costCentres) {
      if (!centre.postingAllowed) {
        throw new MissingDimensionError('Cost Centre', `"${centre.code}" is marked non-posting in the approved cost-centre master`);
      }
    }
    this.checkCostCentreApplication(targets, costCentres);
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

  /**
   * A line's cost centre must belong to the business it is charging.
   *
   * The client's posting engine says it of every line that needs a centre:
   * "Active; Posting Allowed = Yes; application matches or approved YifrehCore
   * shared centre". The first two clauses are checked above. This is the
   * third, and without it a poultry cost could be attributed to a snail
   * centre and nothing would object — the ledger would balance, the segment
   * report would be wrong, and the farm would find out at the year end.
   *
   * The centres the workbook provisions carry their application (SNP-*
   * YifrehSnail, PLP-* YifrehPoultry, COR-* and FDM-* YifrehCore, which is
   * the shared one and always allowed). Centres on the older charts carry
   * none, so they are left alone: this is the approved chart's rule and
   * inventing an application for a centre nobody classified would refuse
   * postings the farm has always made.
   */
  private checkCostCentreApplication(
    targets: DimensionValidationTarget[],
    costCentres: Array<{ id: string; code: string; approvedApplication: string | null }>,
  ): void {
    const byId = new Map(costCentres.map((centre) => [centre.id, centre]));
    for (const target of targets) {
      const { costCentreId, speciesKey } = target.dimensions;
      if (!costCentreId || !speciesKey) continue;
      const wanted = APPLICATION_FOR_SPECIES[speciesKey];
      // A species the workbook does not classify is not ours to adjudicate.
      if (!wanted) continue;
      const centre = byId.get(costCentreId);
      const application = centre?.approvedApplication?.trim();
      if (!centre || !application || application === SHARED_APPLICATION) continue;
      if (application !== wanted) {
        throw new MissingDimensionError(
          'Cost Centre',
          `"${centre.code}" belongs to ${application}, so it cannot carry a ${speciesKey} cost — ` +
            `use one of that business's own centres or a shared ${SHARED_APPLICATION} centre`,
          target.lineNumber,
        );
      }
    }
  }
}

/** The workbook's application for each species it carries. */
const APPLICATION_FOR_SPECIES: Record<string, string> = {
  snail: 'YifrehSnail',
  poultry: 'YifrehPoultry',
};

/** The shared application, whose centres any business may charge. */
const SHARED_APPLICATION = 'YifrehCore';
