import type { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import type { PostingService } from '../../src/posting/posting.service';
import type { WorkflowService } from '../../src/workflow/workflow.service';
import type { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { KpiService } from '../../src/reporting/kpi.service';
import { CustomerReceiptService } from '../../src/sales/customer-receipt.service';
import { SalesPricingService } from '../../src/sales/sales-pricing.service';
import { SupplierPaymentService } from '../../src/procurement/supplier-payment.service';
import { ProcurementConfigService } from '../../src/procurement/procurement-config.service';
import { TaxEngineService } from '../../src/tax/tax-engine.service';
import { TaxRegisterService } from '../../src/tax/tax-register.service';

/** The KPI service with its real collaborators, as the API wires it. */
export function kpiService(prisma: PrismaService, posting: PostingService, workflow: WorkflowService, pl: ProfitLossService) {
  const audit = new AuditService(prisma);
  const tax = new TaxEngineService(prisma);
  const registers = new TaxRegisterService(prisma, tax);
  return new KpiService(
    prisma,
    pl,
    new CustomerReceiptService(prisma, audit, posting, workflow, new SalesPricingService(prisma, tax), registers),
    new SupplierPaymentService(prisma, audit, posting, workflow, tax, registers, new ProcurementConfigService(prisma)),
  );
}

/** The KPIs by key. */
export async function kpisByKey(service: KpiService, companyId: string) {
  return Object.fromEntries((await service.build(companyId)).map((k) => [k.key, k]));
}
