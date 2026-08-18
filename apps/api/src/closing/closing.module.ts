import { Module } from '@nestjs/common';
import { PeriodCloseService } from './period-close.service';
import { YearEndService } from './year-end.service';

/**
 * Period-End & Year-End Closing (§8).
 *
 * §8 note 5: "Must be reusable across SnailPro, PoultryPro and future
 * BioAssetPro products." Nothing here names a module or a species — it works
 * against the ledger, the calendar and the chart of accounts, all of which are
 * shared.
 */
@Module({
  providers: [PeriodCloseService, YearEndService],
  exports: [PeriodCloseService, YearEndService],
})
export class ClosingModule {}
