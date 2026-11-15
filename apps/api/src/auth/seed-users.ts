/**
 * Creates one user per rung of the §2 approval ladder, plus one per role the
 * client's `Role_RACI_KPI` sheet names that `permissions.ts` now recognises.
 *
 * This lives with the API rather than in the database seed because the password
 * format is an auth concern, and having two places that know how to write a
 * password hash is exactly how the two drift apart.
 *
 * Separate people per rung is not decoration: maker-checker means the same
 * human cannot raise and approve, so a ladder with nobody on it cannot be
 * exercised at all.
 *
 * The RACI-only roles below (Storekeeper onward) do NOT sit on the approval
 * ladder. They are separate operational/administrative roles, with API access
 * limited to routes whose `@Roles(...)` guard names them. A seeded sign-in
 * proves the account can reach the application; route-level tests are still
 * needed to prove each allowed and denied action.
 *
 * Run from the repo root:  npm run db:seed:users
 */

import { createPrismaClient } from '../prisma/prisma-client';
import { hashPassword } from './password';

const prisma = createPrismaClient();

const ROLES = {
  supervisor: 'PRODUCTION_SUPERVISOR',
  farmManager: 'FARM_MANAGER',
  financeManager: 'FINANCE_MANAGER',
  controller: 'FINANCE_CONTROLLER',
  cfo: 'CFO',
  mdCeo: 'MD_CEO',
  administrator: 'ADMINISTRATOR',
  // RACI roles with no rung on the approval ladder — see the file header.
  farmAttendant: 'FARM_ATTENDANT',
  snailSupervisor: 'SNAIL_SUPERVISOR',
  poultrySupervisor: 'POULTRY_SUPERVISOR',
  procurementOfficer: 'PROCUREMENT_OFFICER',
  storekeeper: 'STOREKEEPER',
  qaOfficer: 'QA_OFFICER',
  productionLead: 'PRODUCTION_LEAD',
  apOfficer: 'AP_OFFICER',
  salesOfficer: 'SALES_OFFICER',
  arOfficer: 'AR_OFFICER',
  farmAccountant: 'FARM_ACCOUNTANT',
  treasuryOfficer: 'TREASURY_OFFICER',
  systemAdmin: 'SYSTEM_ADMIN',
  internalAuditor: 'INTERNAL_AUDITOR',
  hrManager: 'HR_MANAGER',
  hrOfficer: 'HR_OFFICER',
} as const;

const PEOPLE = [
  { email: 'admin@bioassetpro.ng', fullName: 'System Administrator', roles: [ROLES.administrator] },
  { email: 'supervisor@bioassetpro.ng', fullName: 'Adaeze Okonkwo', roles: [ROLES.supervisor] },
  { email: 'farm.manager@bioassetpro.ng', fullName: 'Chinedu Eze', roles: [ROLES.farmManager] },
  { email: 'finance.manager@bioassetpro.ng', fullName: 'Funmilayo Adeyemi', roles: [ROLES.financeManager] },
  { email: 'controller@bioassetpro.ng', fullName: 'Ibrahim Danjuma', roles: [ROLES.controller] },
  { email: 'cfo@bioassetpro.ng', fullName: 'Ngozi Balogun', roles: [ROLES.cfo] },
  { email: 'md.ceo@bioassetpro.ng', fullName: 'Amina Bello', roles: [ROLES.mdCeo] },

  // RACI-named roles — see the file header on what signing in as these does
  // and does not prove.
  { email: 'attendant@bioassetpro.ng', fullName: 'Musa Garba', roles: [ROLES.farmAttendant] },
  { email: 'snail.supervisor@bioassetpro.ng', fullName: 'Blessing Nwachukwu', roles: [ROLES.snailSupervisor] },
  { email: 'poultry.supervisor@bioassetpro.ng', fullName: 'Yakubu Suleiman', roles: [ROLES.poultrySupervisor] },
  { email: 'procurement@bioassetpro.ng', fullName: 'Kemi Ogunleye', roles: [ROLES.procurementOfficer] },
  { email: 'storekeeper@bioassetpro.ng', fullName: 'Tunde Bakare', roles: [ROLES.storekeeper] },
  { email: 'qa@bioassetpro.ng', fullName: 'Halima Bello', roles: [ROLES.qaOfficer] },
  { email: 'production.lead@bioassetpro.ng', fullName: 'Emeka Umeh', roles: [ROLES.productionLead] },
  { email: 'ap@bioassetpro.ng', fullName: 'Grace Effiong', roles: [ROLES.apOfficer] },
  { email: 'sales@bioassetpro.ng', fullName: 'Segun Afolabi', roles: [ROLES.salesOfficer] },
  { email: 'ar@bioassetpro.ng', fullName: 'Ifeoma Chukwu', roles: [ROLES.arOfficer] },
  { email: 'farm.accountant@bioassetpro.ng', fullName: 'Bolaji Owolabi', roles: [ROLES.farmAccountant] },
  { email: 'treasury@bioassetpro.ng', fullName: 'Amaka Nnamdi', roles: [ROLES.treasuryOfficer] },
  { email: 'sysadmin@bioassetpro.ng', fullName: 'David Okafor', roles: [ROLES.systemAdmin] },
  { email: 'auditor@bioassetpro.ng', fullName: 'Fatima Yusuf', roles: [ROLES.internalAuditor] },
  { email: 'hr.manager@bioassetpro.ng', fullName: 'Nneka Obi', roles: [ROLES.hrManager] },
  { email: 'hr.officer@bioassetpro.ng', fullName: 'Samuel James', roles: [ROLES.hrOfficer] },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed development users in production. Create users through the admin screens.',
    );
  }

  const password = process.env.SEED_PASSWORD ?? 'admin123@';
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
      /*
       * The password IS reset on every run, deliberately.
       *
       * This used to preserve it, on the reasoning that re-seeding should not
       * clobber a password somebody had changed. The effect was worse than the
       * problem: the script ends by printing "Password for all of them: X", and
       * for every account that already existed that line was false. A seed that
       * reports credentials it did not set sends you to a login screen that
       * rejects you with no clue why.
       *
       * These are development fixtures — the script refuses to run in
       * production at all — so resetting them is the honest behaviour, and it
       * makes the line at the end true.
       */
      update: {
        fullName: person.fullName,
        roles: person.roles,
        companyId: company.id,
        passwordHash,
      },
      create: { ...person, passwordHash, companyId: company.id },
    });
  }

  console.log(`Seeded ${PEOPLE.length} users against ${company.name}, one per role:`);
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
