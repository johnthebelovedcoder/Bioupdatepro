import { Module } from '@nestjs/common';
import { FarmConfigController } from './farm-config.controller';
import { FarmConfigService } from './farm-config.service';

@Module({
  controllers: [FarmConfigController],
  providers: [FarmConfigService],
  exports: [FarmConfigService],
})
export class FarmConfigModule {}
