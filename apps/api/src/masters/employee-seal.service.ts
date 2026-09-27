import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptionConfigured, fingerprint, isSealed, open, sealEmployeeFields, SENSITIVE_EMPLOYEE_FIELDS } from '../common/sensitive';

/**
 * Encrypts the bank and statutory numbers of employees written before
 * PII_ENCRYPTION_KEY was set, and fills in the fingerprints the duplicate
 * checks use. Runs once at start-up and does nothing for records already
 * sealed, so it is safe on every boot.
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
      if (sealed > 0) this.logger.log(`Encrypted the bank and statutory numbers of ${sealed} employee record(s).`);
    } catch (error) {
      this.logger.error(`Could not encrypt existing employee numbers: ${(error as Error).message}`);
    }
  }

  /** Seal every unsealed record, company by company. Returns how many records changed. */
  async sealAll(): Promise<{ sealed: number }> {
    if (!encryptionConfigured()) return { sealed: 0 };
    let sealed = 0;
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const { id: companyId } of companies) {
      const employees = await this.prisma.employee.findMany({
        where: { companyId },
        select: { id: true, accountNumber: true, tin: true, nhfNumber: true, pensionRsaNumber: true, accountNumberHash: true, tinHash: true },
      });
      for (const employee of employees) {
        const unsealed = SENSITIVE_EMPLOYEE_FIELDS.some((f) => employee[f] && !isSealed(employee[f]));
        const plainAccount = open(employee.accountNumber);
        const plainTin = open(employee.tin);
        const stale = employee.accountNumberHash !== fingerprint(plainAccount) || employee.tinHash !== fingerprint(plainTin);
        if (!unsealed && !stale) continue;
        const data = sealEmployeeFields(Object.fromEntries(SENSITIVE_EMPLOYEE_FIELDS.map((f) => [f, open(employee[f])])));
        await this.prisma.employee.updateMany({ where: { id: employee.id, companyId }, data });
        sealed += 1;
      }
    }
    return { sealed };
  }
}
