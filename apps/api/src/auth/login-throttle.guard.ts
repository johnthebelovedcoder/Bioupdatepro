import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/** The throttler whose bucket is one account rather than one caller. */
export const ACCOUNT_THROTTLER = 'account';

/** The shape of a request this guard needs, which is all it looks at. */
export interface ThrottledRequest {
  user?: { userId?: unknown } | null;
  body?: unknown;
  params?: Record<string, unknown> | null;
}

/**
 * Brute-force protection for sign-in, counted per account.
 *
 * The limit used to be per caller, deliberately: keying on the email in the
 * body would let an attacker rotate through addresses to stay under it while
 * hammering one password, which is the realistic attack on a farm where every
 * address follows the same pattern. That reasoning holds only while the caller
 * is a person. It is not: the sign-in form posts to the web server, which
 * calls this API itself, so every member of staff arrives from one address.
 * "Ten attempts per caller" was really ten attempts per company per fifteen
 * minutes — one person's typing locked out everybody, and an attacker coming
 * to the API directly got a bucket of their own anyway.
 *
 * So the account gets the tight bucket, and the caller keeps a loose ceiling
 * (see the routes' own @Throttle), which is what stops the rotation attack the
 * original note was written about. A farm signing in for the morning never
 * approaches the ceiling; somebody working through a password list does.
 *
 * Sign-in and the authenticator step are identified by different things — an
 * email on one, a challenge token on the other — and the token is hashed
 * because this key outlives the request and a challenge token is a credential.
 *
 * A request that names no account at all — a form posted with the email blank,
 * a malformed body — is not counted against the account bucket. Keying those on
 * the caller recreated the very bug this guard exists to fix, one pile of ten
 * attempts per fifteen minutes shared by everyone arriving through the web
 * server. They still count against the caller's ceiling, which is what bounds
 * them; and a request naming nobody cannot be an attempt on anybody's password.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name === ACCOUNT_THROTTLER) {
      const request = requestProps.context.switchToHttp().getRequest<ThrottledRequest>();
      if (!accountKey(request)) return true;
    }
    return super.handleRequest(requestProps);
  }

  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (name !== ACCOUNT_THROTTLER) return super.generateKey(context, suffix, name);
    const request = context.switchToHttp().getRequest<ThrottledRequest>();
    // handleRequest has already let an unidentified request past this throttler,
    // so the fallback is unreachable; it is here so a future caller of this
    // method cannot silently key an anonymous attempt on the web server.
    return super.generateKey(context, accountKey(request) ?? `anonymous:${suffix}`, name);
  }
}

/**
 * Whose attempt this is, or null when the request names nobody — in which case
 * the account throttler sits the request out entirely and only the caller's
 * ceiling applies.
 *
 * Four ways a request says who it is for, in the order they are trusted:
 * the signed-in user (the authenticator confirmation, where the body carries
 * only a code), the email being acted on, the challenge token of a sign-in
 * half-finished, and the single-use token in the path — an invitation being
 * accepted or a password being reset.
 *
 * Tokens are hashed. This key outlives the request, and each of those tokens
 * is a credential.
 */
export function accountKey(request: ThrottledRequest | null | undefined): string | null {
  if (!request || typeof request !== 'object') return null;

  const userId = request.user?.userId;
  if (typeof userId === 'string' && userId.trim()) return `user:${userId.trim()}`;

  const body = (typeof request.body === 'object' && request.body ? request.body : {}) as {
    email?: unknown;
    challengeToken?: unknown;
  };
  if (typeof body.email === 'string' && body.email.trim()) {
    // The same address in any casing is the same account, as it is at sign-in.
    return `email:${body.email.trim().toLowerCase()}`;
  }
  if (typeof body.challengeToken === 'string' && body.challengeToken.trim()) {
    return `challenge:${digest(body.challengeToken)}`;
  }

  const token = request.params?.token;
  if (typeof token === 'string' && token.trim()) return `token:${digest(token)}`;

  return null;
}

function digest(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex').slice(0, 32);
}
