import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * One box, across everything the caller may see.
 *
 * Open to any signed-in role deliberately: the service decides which kinds of
 * record each role gets back, which is the correct place for that decision.
 * Gating the endpoint by role instead would mean a production supervisor could
 * not search at all, when what they should get is a smaller set of results.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @AnyRole('Everyone searches; the service decides what each role finds.')
  @Get()
  async find(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const results = await this.search.search({
      companyId,
      roles: actor.roles,
      query: q ?? '',
      ...(limit ? { limit: Number(limit) } : {}),
    });
    return { query: q ?? '', results };
  }
}
