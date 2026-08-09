import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { WorkflowModule } from './workflow/workflow.module';
import { TaxModule } from './tax/tax.module';
import { MastersModule } from './masters/masters.module';
import { JournalsModule } from './journals/journals.module';
import { PayrollModule } from './payroll/payroll.module';
import { SalesModule } from './sales/sales.module';
import { ProcurementModule } from './procurement/procurement.module';
import { MastersController } from './masters/masters.controller';
import { MasterDataController } from './masters/master-data.controller';
import { WorkflowController } from './workflow/workflow.controller';
import { TaxController } from './tax/tax.controller';
import { JournalsController } from './journals/journals.controller';
import { PayrollController } from './payroll/payroll.controller';
import { DemoController } from './demo/demo.controller';
import { PanelController } from './demo/panel.controller';

@Module({
  imports: [CoreModule, WorkflowModule, TaxModule, MastersModule, JournalsModule, PayrollModule, SalesModule, ProcurementModule],
  controllers: [
    PanelController,
    MastersController,
    MasterDataController,
    WorkflowController,
    TaxController,
    JournalsController,
    PayrollController,
    DemoController,
  ],
})
export class AppModule {}
