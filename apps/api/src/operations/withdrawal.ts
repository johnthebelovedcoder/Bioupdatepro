import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@bioassetpro/database';

type Client = Prisma.TransactionClient | PrismaClient;

const DAY = 24 * 60 * 60 * 1000;

/** The day a treatment's withdrawal ends: the recorded day, else given-on plus its days. */
export function clearsOn(treatment: { givenOn: Date; withdrawalDays: number; safeToSellFrom: Date | null }): Date | null {
  if (treatment.safeToSellFrom) return treatment.safeToSellFrom;
  if (treatment.withdrawalDays > 0) return new Date(treatment.givenOn.getTime() + treatment.withdrawalDays * DAY);
  return null;
}

/**
 * The withdrawal period still running on a population on a day, if any
 * (handbook §29, §59.5 "prevents … withdrawal breaches"): the latest-ending
 * treatment whose medicine may still be in the animals.
 */
export async function runningWithdrawal(
  client: Client,
  companyId: string,
  groupId: string,
  on: Date,
): Promise<{ name: string; givenOn: Date; until: Date } | null> {
  const treatments = await client.treatmentRecord.findMany({
    where: { companyId, groupId, OR: [{ withdrawalDays: { gt: 0 } }, { safeToSellFrom: { not: null } }] },
    select: { name: true, givenOn: true, withdrawalDays: true, safeToSellFrom: true },
  });
  let running: { name: string; givenOn: Date; until: Date } | null = null;
  for (const t of treatments) {
    const until = clearsOn(t);
    if (until && until > on && (!running || until > running.until)) running = { name: t.name, givenOn: t.givenOn, until };
  }
  return running;
}

/**
 * Refuse to let animals leave for food — harvest, sale, slaughter — while a
 * treatment's withdrawal period is running. Culls and deaths are not food and
 * are not stopped.
 */
export async function assertNoWithdrawal(client: Client, params: { companyId: string; groupId: string; groupCode: string; on: Date; doing: string }) {
  const running = await runningWithdrawal(client, params.companyId, params.groupId, params.on);
  if (running) {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    throw new BadRequestException(
      `${params.groupCode} cannot be ${params.doing} on ${day(params.on)}: it was given ${running.name} on ${day(running.givenOn)} and its withdrawal period runs until ${day(running.until)}. Wait until then, or cull rather than sell.`,
    );
  }
}
