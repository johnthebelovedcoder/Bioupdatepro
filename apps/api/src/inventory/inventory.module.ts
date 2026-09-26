import { Module } from '@nestjs/common';
import { InventoryTransferService } from './inventory-transfer.service';
import { StockCountService } from './stock-count.service';
import { PostingControlModule } from '../posting-control/posting-control.module';

/**
 * General inventory transfer and write-off (PCR-012–014, US-897-008).
 * `InventoryController` is registered in AppModule, matching every other
 * feature module's controller in this codebase.
 */
@Module({
  imports: [PostingControlModule],
  providers: [InventoryTransferService, StockCountService],
  // Exported: InventoryController is registered in AppModule and needs both.
  exports: [InventoryTransferService, StockCountService],
})
export class InventoryModule {}
