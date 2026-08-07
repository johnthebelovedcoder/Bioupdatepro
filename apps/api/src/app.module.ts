import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { WorkflowModule } from './workflow/workflow.module';
import { MastersController } from './masters/masters.controller';
import { WorkflowController } from './workflow/workflow.controller';
import { DemoController } from './demo/demo.controller';
import { PanelController } from './demo/panel.controller';

@Module({
  imports: [CoreModule, WorkflowModule],
  controllers: [
    PanelController,
    MastersController,
    WorkflowController,
    DemoController,
  ],
})
export class AppModule {}
