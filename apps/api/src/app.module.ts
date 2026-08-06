import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { MastersController } from './masters/masters.controller';
import { DemoController } from './demo/demo.controller';
import { PanelController } from './demo/panel.controller';

@Module({
  imports: [CoreModule],
  controllers: [PanelController, MastersController, DemoController],
})
export class AppModule {}
