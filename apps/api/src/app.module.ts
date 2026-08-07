import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { WorkflowModule } from './workflow/workflow.module';
import { TaxModule } from './tax/tax.module';
import { MastersModule } from './masters/masters.module';
import { MastersController } from './masters/masters.controller';
import { MasterDataController } from './masters/master-data.controller';
import { WorkflowController } from './workflow/workflow.controller';
import { TaxController } from './tax/tax.controller';
import { DemoController } from './demo/demo.controller';
import { PanelController } from './demo/panel.controller';

@Module({
  imports: [CoreModule, WorkflowModule, TaxModule, MastersModule],
  controllers: [
    PanelController,
    MastersController,
    MasterDataController,
    WorkflowController,
    TaxController,
    DemoController,
  ],
})
export class AppModule {}
