import { Module, OnModuleInit } from '@nestjs/common';
import { PayeEngineService } from './paye-engine.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { PayrollRunService } from './payroll-run.service';
import { PayrollSetupService } from './payroll-setup.service';
import { PayrollPaymentService } from './payroll-payment.service';
import { PayrollPaymentPostingHandler, PayrollPostingHandler } from './payroll.handler';
import { WorkflowService } from '../workflow/workflow.service';

/**
 * HR & Payroll (§7).
 *
 * The two engines are exported so period-end reporting and any future
 * what-if tooling can call them without going through a run.
 */
@Module({
  providers: [
    PayeEngineService,
    StatutoryEngineService,
    PayrollRunService,
    PayrollSetupService,
    PayrollPaymentService,
    PayrollPostingHandler,
    PayrollPaymentPostingHandler,
  ],
  exports: [
    PayeEngineService,
    StatutoryEngineService,
    PayrollRunService,
    PayrollSetupService,
    PayrollPaymentService,
  ],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly handler: PayrollPostingHandler,
    private readonly paymentHandler: PayrollPaymentPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.handler);
    this.workflow.register(this.paymentHandler);
  }
}
