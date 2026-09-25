import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';
import {
  ROLE_ACCOUNTS,
  SPECIES_ACCOUNTS,
  type AccountRole,
  type ChartVersion,
  type Species,
  type SpeciesRole,
} from './chart';

type Client = PrismaService | Prisma.TransactionClient;

/** Resolves an account by what it is for, on the company's own chart. See chart.ts. */
@Injectable()
export class ChartService {
  constructor(private readonly prisma: PrismaService) {}

  async version(companyId: string, client: Client = this.prisma): Promise<ChartVersion> {
    const company = await client.company.findUnique({ where: { id: companyId }, select: { chartVersion: true } });
    return company?.chartVersion === 'SPEC' ? 'SPEC' : 'LEGACY';
  }

  async number(companyId: string, role: AccountRole, client: Client = this.prisma): Promise<string> {
    const [legacy, spec] = ROLE_ACCOUNTS[role];
    return (await this.version(companyId, client)) === 'SPEC' ? spec : legacy;
  }

  /** The account's id. Refuses, naming the account, if the chart does not have it. */
  async account(companyId: string, role: AccountRole, client: Client = this.prisma): Promise<string> {
    return this.idOf(companyId, await this.number(companyId, role, client), role, client);
  }

  /** Several at once, as `{ role: id }`. */
  async accounts<R extends AccountRole>(companyId: string, roles: R[], client: Client = this.prisma): Promise<Record<R, string>> {
    const version = await this.version(companyId, client);
    const numbers = roles.map((role) => ROLE_ACCOUNTS[role][version === 'SPEC' ? 1 : 0]);
    const rows = await client.gLAccount.findMany({
      where: { companyId, accountNumber: { in: numbers }, active: true },
      select: { id: true, accountNumber: true },
    });
    const byNumber = new Map(rows.map((r) => [r.accountNumber, r.id]));
    const out = {} as Record<R, string>;
    roles.forEach((role, i) => {
      const id = byNumber.get(numbers[i]!);
      if (!id) throw missing(numbers[i]!, role);
      out[role] = id;
    });
    return out;
  }

  /** The number for a species-dependent purpose; null where SPEC does not hold it (snail rearing cost). */
  async speciesNumber(companyId: string, role: SpeciesRole, species: string, client: Client = this.prisma): Promise<string | null> {
    const [legacy, spec] = SPECIES_ACCOUNTS[role];
    if ((await this.version(companyId, client)) === 'LEGACY') return legacy;
    return spec[normalise(species)];
  }

  async speciesAccount(companyId: string, role: SpeciesRole, species: string, client: Client = this.prisma): Promise<string | null> {
    const number = await this.speciesNumber(companyId, role, species, client);
    return number ? this.idOf(companyId, number, role, client) : null;
  }

  /** Any account by number, refusing clearly when it is missing — for the few numbers not tied to a role. */
  async idOf(companyId: string, number: string, purpose: string, client: Client = this.prisma): Promise<string> {
    const row = await client.gLAccount.findFirst({
      where: { companyId, accountNumber: number, active: true },
      select: { id: true },
    });
    if (!row) throw missing(number, purpose);
    return row.id;
  }
}

function normalise(species: string): Species {
  return species === 'snail' ? 'snail' : 'poultry';
}

function missing(number: string, purpose: string) {
  return new AccountingRuleViolation(
    'Chart of accounts',
    `Account ${number} (${purpose}) is missing or inactive in this company's chart.`,
    { accountNumber: number, purpose },
  );
}
