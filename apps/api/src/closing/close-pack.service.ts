import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrialBalanceService } from '../reporting/trial-balance.service';
import { fingerprintOf, rebuild, type PackContent } from './close-pack';

/** The close packs stored at period and year close, and whether each still matches. */
@Injectable()
export class ClosePackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trialBalance: TrialBalanceService,
  ) {}

  async list(companyId: string, financialYearId?: string) {
    const packs = await this.prisma.closePack.findMany({
      where: { companyId, ...(financialYearId ? { financialYearId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, scope: true, report: true, financialYearId: true, financialPeriodId: true, sha256: true, createdAt: true, createdById: true },
    });
    const [periods, years, users] = await Promise.all([
      this.prisma.financialPeriod.findMany({
        where: { financialYear: { companyId }, id: { in: packs.map((p) => p.financialPeriodId).filter((id): id is string => Boolean(id)) } },
        select: { id: true, name: true },
      }),
      this.prisma.financialYear.findMany({ where: { companyId, id: { in: packs.map((p) => p.financialYearId) } }, select: { id: true, code: true } }),
      this.prisma.user.findMany({ where: { companyId, id: { in: packs.map((p) => p.createdById) } }, select: { id: true, fullName: true } }),
    ]);
    return packs.map((p) => ({
      id: p.id,
      scope: p.scope,
      report: p.report,
      period: p.financialPeriodId ? (periods.find((x) => x.id === p.financialPeriodId)?.name ?? null) : null,
      year: years.find((y) => y.id === p.financialYearId)?.code ?? null,
      sha256: p.sha256,
      closedAt: p.createdAt.toISOString(),
      closedBy: users.find((u) => u.id === p.createdById)?.fullName ?? null,
    }));
  }

  /**
   * Check a pack: is the stored copy as it was written (`intact`), and does
   * the ledger still give the same figures (`matches`)? Where it does not,
   * say which accounts moved and by how much.
   */
  async verify(companyId: string, packId: string) {
    const pack = await this.prisma.closePack.findFirst({ where: { id: packId, companyId } });
    if (!pack) throw new NotFoundException('No such close pack.');
    const stored = pack.content as unknown as PackContent;
    const intact = fingerprintOf(stored) === pack.sha256;
    const now = await rebuild(this.trialBalance, pack);
    const currentSha256 = fingerprintOf(now);

    const net = (rows: PackContent['rows']) => new Map(rows.map(([n, name, dr, cr]) => [n, { name, net: BigInt(dr) - BigInt(cr) }]));
    const then = net(stored.rows);
    const today = net(now.rows);
    const changes = [...new Set([...then.keys(), ...today.keys()])]
      .sort()
      .map((n) => ({
        accountNumber: n,
        accountName: (today.get(n) ?? then.get(n))!.name,
        atCloseKobo: (then.get(n)?.net ?? 0n).toString(),
        nowKobo: (today.get(n)?.net ?? 0n).toString(),
      }))
      .filter((c) => c.atCloseKobo !== c.nowKobo);

    return {
      id: pack.id,
      sha256: pack.sha256,
      currentSha256,
      intact,
      matches: intact && currentSha256 === pack.sha256,
      changes,
      closedAt: pack.createdAt.toISOString(),
    };
  }
}
