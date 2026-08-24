import { Module } from '@nestjs/common';
import { SearchService } from './search.service';

/** Cross-cutting search over every module's records. */
@Module({
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
