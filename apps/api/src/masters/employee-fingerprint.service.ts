import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { employeeSensitiveFields, FINGERPRINTED, isLegacyEncrypted, SENSITIVE_EMPLOYEE_FIELDS } from '../common/sensitive';

@Injectable()
export class EmployeeFingerprintService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmployeeFingerprintService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    const { updated } = await this.rebuildFingerprints();
    if (updated > 0) this.logger.log(`Rebuilt duplicate-check fingerprints for ${updated} employee record(s).`);
  }

  async rebuildFingerprints(): Promise<{ updated: number }> {
    let updated = 0;
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
        if (SENSITIVE_EMPLOYEE_FIELDS.some((field) => isLegacyEncrypted(employee[field]))) {
          throw new Error(
            'Found legacy encrypted employee values after PII encryption was disabled. Restore the matching PII_ENCRYPTION_KEY and recover those values before deploying this version.',
          );
        }

        const fingerprints = employeeSensitiveFields(
          Object.fromEntries(SENSITIVE_EMPLOYEE_FIELDS.map((field) => [field, employee[field]])),
        );
        const expected = Object.fromEntries(
          Object.values(FINGERPRINTED).map((field) => [field, fingerprints[field]]),
        );
        if (
          Object.entries(expected).every(([field, value]) => employee[field as keyof typeof employee] === value)
        ) {
          continue;
        }
        await this.prisma.employee.updateMany({ where: { id: employee.id, companyId }, data: expected });
        updated += 1;
      }

      const references = await this.prisma.employeeVerification.findMany({
        where: { companyId, checkType: { in: ['BANK', 'TAX_ID', 'NIN', 'PENSION', 'NHF', 'NHIA'] }, reference: { startsWith: 'enc:v1:' } },
        select: { id: true },
      });
      if (references.length > 0) {
        throw new Error(
          'Found legacy encrypted identity-check references after PII encryption was disabled. Restore the matching PII_ENCRYPTION_KEY and recover those values before deploying this version.',
        );
      }
    }
    return { updated };
  }
}
