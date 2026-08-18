import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/** Marks a route as reachable without a token (login, health). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * The acting user, assembled from the verified token and the request itself.
 *
 * This is the ONLY way a service should learn who is acting. Taking the actor
 * from the request body — which is what the controllers did before auth existed
 * — makes maker-checker decorative: the browser could simply name someone else
 * as the approver. Rule 4 requires it to be structural.
 *
 * The IP and device come from the request rather than the client, because Rule
 * 9 requires them on every audit record and a self-reported device string is
 * not evidence of anything.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkflowActor => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // The guard should have rejected this already; if it did not, fail closed
      // rather than posting with an empty actor.
      throw new Error('No authenticated user on the request.');
    }

    return {
      userId: user.userId,
      roles: user.roles,
      ipAddress: clientIp(request),
      device: request.headers['user-agent'] ?? null,
    };
  },
);

/**
 * The tenant this request may read and write.
 *
 * The counterpart to `CurrentUser`, and it exists for the same reason: the
 * company was previously taken from a query parameter, so any signed-in user
 * could read any other company's trial balance, journals and dimensions by
 * changing a value in the URL. Authentication without this is only a check that
 * somebody is signed in, not a check that they are allowed to see the thing
 * they asked for.
 *
 * Returns a non-nullable string and refuses the request when the user has no
 * company, so a controller cannot accidentally build a query with `companyId:
 * undefined` — which in Prisma is not "no company" but "no filter", and would
 * hand back every tenant's rows.
 */
export const CurrentCompany = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const companyId = request.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException('This account is not attached to a company.');
    }
    return companyId;
  },
);

function clientIp(request: Request): string | null {
  // Behind a proxy Express only sees the proxy unless `trust proxy` is set, so
  // read the forwarded header first and take the original client (leftmost).
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip ?? request.socket.remoteAddress ?? null;
}
