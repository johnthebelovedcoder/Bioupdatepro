import { Global, Module } from '@nestjs/common';
import { TaxEngineService } from './tax-engine.service';
import { TaxRegisterService } from './tax-register.service';
import { TaxPeriodService } from './tax-period.service';

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
  providers: [TaxEngineService, TaxRegisterService, TaxPeriodService],
  exports: [TaxEngineService, TaxRegisterService, TaxPeriodService],
})
export class TaxModule {}
