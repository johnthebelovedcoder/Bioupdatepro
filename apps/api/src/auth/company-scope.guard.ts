import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.service';

/**
 * A request may only ever name its own company.
 *
 * Most controllers here take `companyId` from the client — a query parameter, a
 * path segment, or a field in the body — and pass it straight into a Prisma
 * `where`. Each one is the same hole: being signed in proves who you are, not
 * that the rows you asked for are yours, so any authenticated user could read
 * another tenant's payroll, tax registers, journals or master data by changing
 * a value in the URL.
 *
 * Fixing that one signature at a time means rewriting several dozen handlers
 * and their tests, and — worse — leaving the same trap set for every handler
 * written afterwards. This closes the whole class in one place: whatever
 * company the request names, it must be the caller's own. Existing signatures
 * keep working unchanged, and a new controller is covered the moment it is
 * added rather than when somebody remembers.
 *
 * What this does NOT do, stated plainly because the difference matters:
 *
 *   · It cannot scope a route that names no company at all. Such a route is
 *     either filtered internally or it is a leak, and the guard cannot tell
 *     which. The audit register was one of those and is fixed separately.
 *
 *   · It does not check ownership of a record fetched by its own id. A request
 *     for /journal/<some other tenant's id> names no company, so nothing here
 *     objects. That needs a check where the record is loaded, and is the next
 *     thing to do.
 *
 * So this is a floor, not a ceiling.
 */
@Injectable()
export class CompanyScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Only HTTP carries the parameters this inspects.
    if (context.getType() !== 'http') return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const requested = requestedCompanyIds(request);
    if (requested.length === 0) return true;

    const own = request.user?.companyId;
    if (!own) {
      // Naming a company while belonging to none is never legitimate.
      throw new ForbiddenException('This account is not attached to a company.');
    }

    for (const candidate of requested) {
      if (candidate !== own) {
        // Deliberately does not echo either id back. The response should not
        // confirm to a prober that some other company id is a real one.
        throw new ForbiddenException('That company is not yours to read.');
      }
    }

    return true;
  }
}

/** Every place a request can name a company, as plain strings. */
function requestedCompanyIds(request: Request): string[] {
  const found: string[] = [];

  collect(request.params?.['companyId'], found);
  collect(request.query?.['companyId'], found);

  // Bodies only at the top level. Anything nested belongs to a service that
  // resolves its own parent, and walking arbitrary JSON here would cost more
  // than it protects.
  const body: unknown = request.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    collect((body as Record<string, unknown>)['companyId'], found);
  }

  return found;
}

function collect(value: unknown, into: string[]): void {
  if (typeof value === 'string' && value.trim() !== '') {
    into.push(value);
    return;
  }
  // Express gives an array when a parameter appears more than once. Every one
  // of them has to match, or `?companyId=mine&companyId=theirs` would pass on
  // the strength of the first.
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, into);
  }
}
