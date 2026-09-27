import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  encryptionConfigured,
  fingerprint,
  FINGERPRINTED,
  IDENTITY_CHECKS,
  isSealed,
  open,
  seal,
  sealEmployeeFields,
  SENSITIVE_EMPLOYEE_FIELDS,
} from '../common/sensitive';

/**
 * Encrypts the bank, statutory and identity numbers of employees written
 * before PII_ENCRYPTION_KEY was set — and the evidence references on their
 * identity checks — and fills in the fingerprints the duplicate checks use.
 * Runs once at start-up and does nothing for records already sealed, so it
 * is safe on every boot.
 */
@Injectable()
export class EmployeeSealService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmployeeSealService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    if (!encryptionConfigured()) {
      this.logger.warn('PII_ENCRYPTION_KEY is not set: employee bank and statutory numbers are stored unencrypted.');
      return;
    }
    try {
      const { sealed } = await this.sealAll();
      if (sealed > 0) this.logger.log(`Encrypted the sensitive numbers on ${sealed} employee record(s) and identity-check reference(s).`);
    } catch (error) {
      this.logger.error(`Could not encrypt existing employee numbers: ${(error as Error).message}`);
    }
  }

  /** Seal every unsealed record, company by company. Returns how many records (employees and references) changed. */
  async sealAll(): Promise<{ sealed: number }> {
    if (!encryptionConfigured()) return { sealed: 0 };
    let sealed = 0;
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const { id: companyId } of companies) {
      const employees = await this.prisma.employee.findMany({
        where: { companyId },
        select: {
          id: true,
          accountNumber: true,
          tin: true,
          nhfNumber: true,
          pensionRsaNumber: true,
          nin: true,
          nhiaNumber: true,
          accountNumberHash: true,
          tinHash: true,
          ninHash: true,
        },
      });
      for (const employee of employees) {
        const unsealed = SENSITIVE_EMPLOYEE_FIELDS.some((f) => employee[f] && !isSealed(employee[f]));
        const stale = (Object.entries(FINGERPRINTED) as Array<[keyof typeof FINGERPRINTED, (typeof FINGERPRINTED)[keyof typeof FINGERPRINTED]]>).some(
          ([field, hash]) => employee[hash] !== fingerprint(open(employee[field])),
        );
        if (!unsealed && !stale) continue;
        const data = sealEmployeeFields(Object.fromEntries(SENSITIVE_EMPLOYEE_FIELDS.map((f) => [f, open(employee[f])])));
        await this.prisma.employee.updateMany({ where: { id: employee.id, companyId }, data });
        sealed += 1;
      }

      const references = await this.prisma.employeeVerification.findMany({
        where: { companyId, checkType: { in: [...IDENTITY_CHECKS] }, reference: { not: null } },
        select: { id: true, reference: true },
      });
      for (const row of references) {
        if (isSealed(row.reference)) continue;
        await this.prisma.employeeVerification.updateMany({ where: { id: row.id, companyId }, data: { reference: seal(row.reference) } });
        sealed += 1;
      }
    }
    return { sealed };
  }
}
