import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.service';

export const ROLES_KEY = 'requiredRoles';
export const ANY_ROLE_KEY = 'anyRole';

/**
 * Open to any signed-in user of the company, on purpose.
 *
 * The counterpart to deny-by-default. A route with no annotation at all is now
 * REFUSED, so "everyone may use this" has to be said out loud rather than
 * arrived at by forgetting — and the reason is required, because the next
 * person to read it deserves to know whether the openness was considered or
 * merely inherited.
 */
export const AnyRole = (reason: string) => SetMetadata(ANY_ROLE_KEY, reason);

/**
 * Which roles may reach this route.
 *
 * Holding ANY of the listed roles is enough — they are alternatives, not a set
 * that must all be held. A route reachable by both the finance manager and the
 * controller lists both.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Roles that can reach anything.
 *
 * Only the administrator. The CFO deliberately is NOT here: they
 * sit at the top of the approval ladder, which is a different thing from
 * being able to administer the system, and conflating the two would mean the
 * person who approves the largest payments is also the person who can grant
 * themselves the right to approve them.
 */
const UNIVERSAL = new Set(['ADMINISTRATOR']);

/**
 * Role-based access, enforced at the API.
 *
 * The third and last of the authorisation guards, and the one the staff screen
 * has been admitting was missing. The other two answer different questions:
 * CompanyScopeGuard asks whether the request may name this company,
 * OwnedRecordGuard asks whether it may touch this record. Both were satisfied
 * by any signed-in user of the right farm — so a production supervisor could
 * close an accounting period, run payroll, or invite themselves an
 * administrator, simply by knowing the URL.
 *
 * Hiding those screens in the interface does not fix it. The navigation is a
 * convenience; the API is the boundary. This is the boundary.
 *
 * DENY BY DEFAULT. Every route must say who may reach it — `@Roles(...)` for a
 * restricted one, `@AnyRole(reason)` for one that is open on purpose, `@Public`
 * for one that needs no session at all. A route with none of those is refused,
 * including for an administrator, so the omission surfaces the first time
 * anybody calls it rather than sitting there as an accidental hole.
 *
 * This was opt-in first and flipped afterwards, in that order deliberately: the
 * eighty-odd existing routes were each given an explicit decision while the
 * default was still permissive, so turning it around broke nothing. Flipping
 * first would have taken the whole API down and the change would have been
 * reverted within the hour.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const open = this.reflector.getAllAndOverride<string | undefined>(ANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!required || required.length === 0) && !open) {
      /*
       * DENY BY DEFAULT.
       *
       * An unannotated route is refused rather than allowed. This was opt-in
       * until now, and opt-in has one failure mode that matters: the next route
       * somebody adds is open to every signed-in user of the company, silently,
       * and nothing tells them. The mistake is invisible in review — there is
       * no line to notice the absence of.
       *
       * Refusing instead makes the mistake loud and immediate: the route simply
       * does not work until its author says who may use it. Loud is the whole
       * point. A permission model that fails open is not a permission model.
       */
      throw new ForbiddenException(
        'This endpoint has no access rule and is refused. Annotate it with @Roles or @AnyRole.',
      );
    }

    if (open) return true;

    // Past the check above this cannot be empty, but narrowing it here keeps
    // the guarantee in the type system rather than in a reader's memory.
    const needed = required ?? [];

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const held = request.user?.roles ?? [];

    if (held.some((role) => UNIVERSAL.has(role))) return true;
    if (held.some((role) => needed.includes(role))) return true;

    /*
     * Says what is needed, not what the caller has.
     *
     * Naming the required role is useful — somebody legitimately blocked can go
     * and ask for it. Echoing back what they hold would help an attacker map
     * the permission model from the outside.
     */
    throw new ForbiddenException(
      `This needs one of: ${needed.map(humanRole).join(', ')}. Ask an administrator.`,
    );
  }
}

/**
 * `FARM_ACCOUNTANT` read back to a person as "Farm Accountant".
 *
 * This message reaches whoever the API just refused, in whatever screen
 * rendered the refusal — and every other place a role name reaches an end
 * user already goes through the equivalent transform in
 * `apps/web/src/lib/roles.ts` (same algorithm, same acronym list — the two
 * cannot share a module across the API/web boundary, so this is kept a
 * small, stable, generic string transform rather than anything that could
 * drift into a second source of truth). A refusal that skipped it was the
 * one place left where a raw enum constant, underscores and all, was the
 * actual thing shown to somebody who did nothing wrong except lack a role.
 */
const ACRONYMS = new Set(['cfo', 'ap', 'ar', 'qa']);

function humanRole(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
