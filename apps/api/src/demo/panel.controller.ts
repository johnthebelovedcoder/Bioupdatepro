import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/current-user.decorator';
import { AnyRole } from '../auth/roles.guard';

/**
 * Serves the Phase 1 control panel.
 *
 * A single static file, read from disk on each request so edits show up on
 * refresh without a restart. Deliberately not @nestjs/serve-static — that would
 * add a dependency (and a peer-version fight with Nest 10) to serve one page.
 *
 * Phase 2 onward this is replaced by the Next.js admin app.
 */
// Dev scaffolding: registered only outside production (see AppModule).
@Public()
@Controller()
export class PanelController {
  private readonly panelPath = join(__dirname, '..', '..', 'public', 'index.html');

  @AnyRole('Development-only demo panel; never routable in production.')
  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  panel(): string {
    return readFileSync(this.panelPath, 'utf8');
  }
}
