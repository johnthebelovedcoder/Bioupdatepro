import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';

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

  async resolve(companyId: string, on: Date, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const day = new Date(
      Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()),
    );

    const config = await client.procurementConfiguration.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

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
