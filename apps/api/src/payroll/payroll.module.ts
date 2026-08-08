import { Module, OnModuleInit } from '@nestjs/common';
import { PayeEngineService } from './paye-engine.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { PayrollRunService } from './payroll-run.service';
import { PayrollPostingHandler } from './payroll.handler';
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
    PayrollPostingHandler,
  ],
  exports: [PayeEngineService, StatutoryEngineService, PayrollRunService],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly handler: PayrollPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.handler);
  }
}
