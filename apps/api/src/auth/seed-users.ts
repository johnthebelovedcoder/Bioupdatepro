/**
 * Creates one user per rung of the §2 approval ladder.
 *
 * This lives with the API rather than in the database seed because the password
 * format is an auth concern, and having two places that know how to write a
 * password hash is exactly how the two drift apart.
 *
 * Separate people per rung is not decoration: maker-checker means the same
 * human cannot raise and approve, so a ladder with nobody on it cannot be
 * exercised at all.
 *
 * Run from the repo root:  npm run db:seed:users
 */

import { PrismaClient } from '@bioassetpro/database';
import { hashPassword } from './password';

const prisma = new PrismaClient();

const ROLES = {
  supervisor: 'PRODUCTION_SUPERVISOR',
  farmManager: 'FARM_MANAGER',
  financeManager: 'FINANCE_MANAGER',
  controller: 'FINANCIAL_CONTROLLER',
  managingDirector: 'MANAGING_DIRECTOR',
  administrator: 'ADMINISTRATOR',
} as const;

const PEOPLE = [
  { email: 'admin@bioassetpro.ng', fullName: 'System Administrator', roles: [ROLES.administrator] },
  { email: 'supervisor@bioassetpro.ng', fullName: 'Adaeze Okonkwo', roles: [ROLES.supervisor] },
  { email: 'farm.manager@bioassetpro.ng', fullName: 'Chinedu Eze', roles: [ROLES.farmManager] },
  { email: 'finance.manager@bioassetpro.ng', fullName: 'Funmilayo Adeyemi', roles: [ROLES.financeManager] },
  { email: 'controller@bioassetpro.ng', fullName: 'Ibrahim Danjuma', roles: [ROLES.controller] },
  { email: 'md@bioassetpro.ng', fullName: 'Ngozi Balogun', roles: [ROLES.managingDirector] },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed development users in production. Create users through the admin screens.',
    );
  }

  const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2026';
  const passwordHash = await hashPassword(password);

  /*
   * Everybody belongs to the seeded company.
   *
   * Failing loudly beats defaulting to null: a user with no company resolves to
   * no company-scoped data, so seeding them that way produces six accounts that
   * sign in successfully and then show empty screens — which reads as a bug in
   * the reports rather than as a missing seed step.
   */
  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    throw new Error(
      'No company exists yet. Run `npm run db:seed` first — users have to belong to one.',
    );
  }

  for (const person of PEOPLE) {
    await prisma.user.upsert({
      where: { email: person.email },
      // Re-running must not reset a password someone has since changed.
      update: { fullName: person.fullName, roles: person.roles, companyId: company.id },
      create: { ...person, passwordHash, companyId: company.id },
    });
  }

  console.log(`Seeded ${PEOPLE.length} users against ${company.name}, one per approval rung:`);
  for (const person of PEOPLE) {
    console.log(`  ${person.email.padEnd(34)} ${person.roles.join(', ')}`);
  }
  console.log(`\nPassword for all of them: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
