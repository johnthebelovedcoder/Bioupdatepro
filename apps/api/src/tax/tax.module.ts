import { Global, Module, OnModuleInit } from '@nestjs/common';
import { TaxEngineService } from './tax-engine.service';
import { TaxSetupService } from './tax-setup.service';
import { TaxRegisterService } from './tax-register.service';
import { TaxPeriodService } from './tax-period.service';
import { VatSettlementPostingHandler } from './vat-settlement.handler';
import { WorkflowService } from '../workflow/workflow.service';
import { VatRefundPostingHandler } from './vat-refund.handler';

/**
 * Rule 5: ONE tax engine, available everywhere.
 *
 * Global for the same reason the workflow engine is. Procurement, Sales and
 * Banking each have an obvious local temptation to "just multiply by 7.5%", and
 * the only durable defence is that the shared service is always to hand and no
 * module can construct a second one.
 */
@Global()
@Module({
  providers: [TaxEngineService, TaxRegisterService, TaxPeriodService, TaxSetupService, VatSettlementPostingHandler, VatRefundPostingHandler],
  exports: [TaxEngineService, TaxRegisterService, TaxPeriodService, TaxSetupService],
})
export class TaxModule implements OnModuleInit {
  constructor(private readonly workflow: WorkflowService, private readonly settlementHandler: VatSettlementPostingHandler, private readonly refundHandler: VatRefundPostingHandler) {}

  onModuleInit(): void {
    this.workflow.register(this.settlementHandler);
    this.workflow.register(this.refundHandler);
  }
}
