import { Module } from '@nestjs/common';
import { PeriodCloseService } from './period-close.service';
import { YearEndService } from './year-end.service';
import { IncomeTaxService } from './income-tax.service';
import { PostingControlModule } from '../posting-control/posting-control.module';

/**
 * Period-End & Year-End Closing (§8).
 *
 * §8 note 5: "Must be reusable across SnailPro, PoultryPro and future
 * BioAssetPro products." Nothing here names a module or a species — it works
 * against the ledger, the calendar and the chart of accounts, all of which are
 * shared.
 */
@Module({
  imports: [PostingControlModule],
  providers: [PeriodCloseService, YearEndService, IncomeTaxService],
  exports: [PeriodCloseService, YearEndService, IncomeTaxService],
})
export class ClosingModule {}
