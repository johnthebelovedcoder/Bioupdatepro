import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';
import { chartVersionOf } from '../chart/chart';
import { resolveApprovedMappedAccount } from '../posting-control/approved-account-map';

/**
 * The company's procurement policy on a date (§5).
 *
 * Refuses rather than defaulting. The GRNI account in particular is not
 * optional: without it the receive-then-invoice sequence has nowhere to park
 * the liability, and inventory would be recognised twice.
 */
@Injectable()
export class ProcurementConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(companyId: string, on: Date, tx?: Prisma.TransactionClient, supplierId?: string) {
    const client = tx ?? this.prisma;
    const day = new Date(
      Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()),
    );

    let config = await client.procurementConfiguration.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const approved = (await chartVersionOf(client, companyId)) === 'APPROVED';
    if (approved) {
      const [grni, payables, whtPayable] = await Promise.all([
        resolveApprovedMappedAccount(client, { companyId, application: 'YifrehCore', postingGroup: 'COR-RM', postingKey: 'GRNI', on: day }),
        supplierId
          ? resolveApprovedMappedAccount(client, { companyId, application: 'YifrehCore', masterType: 'Vendor', masterId: supplierId, postingKey: 'AP_CONTROL', on: day })
          : resolveApprovedMappedAccount(client, { companyId, application: 'YifrehCore', postingGroup: 'COR-VEND-LOCAL', postingKey: 'AP_CONTROL', on: day }),
        resolveApprovedMappedAccount(client, { companyId, application: 'YifrehCore', postingGroup: 'COR-WHT-SUP-2', postingKey: 'WHT_PAYABLE', on: day }),
      ]);
      config ??= await client.procurementConfiguration.create({
        data: {
          companyId,
          grniGlAccountId: grni.glAccountId,
          payablesGlAccountId: payables.glAccountId,
          whtPayableGlAccountId: whtPayable.glAccountId,
          effectiveFrom: day,
        },
      });
      return {
        ...config,
        grniGlAccountId: grni.glAccountId,
        payablesGlAccountId: payables.glAccountId,
        whtPayableGlAccountId: whtPayable.glAccountId,
      };
    }

    if (!config) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Procurement configuration',
        `No procurement configuration is effective on ${day.toISOString().slice(0, 10)}. ` +
          `The GRNI and payables accounts, and the three-way match tolerances, are ` +
          `choices this system will not make on the company's behalf.`,
        { companyId, date: day.toISOString().slice(0, 10) },
      );
    }
    return config;
  }
}
