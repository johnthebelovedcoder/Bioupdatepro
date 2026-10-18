import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/** The throttler whose bucket is one account rather than one caller. */
export const ACCOUNT_THROTTLER = 'account';

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
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (name !== ACCOUNT_THROTTLER) return super.generateKey(context, suffix, name);
    const body: unknown = context.switchToHttp().getRequest()?.body;
    return super.generateKey(context, accountKey(body) ?? suffix, name);
  }
}

/**
 * Which account a sign-in attempt is for, or null when the request names none
 * — a malformed body falls back to the caller's own bucket rather than
 * sharing one anonymous bucket with every other malformed request.
 */
export function accountKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { email, challengeToken } = body as { email?: unknown; challengeToken?: unknown };
  if (typeof email === 'string' && email.trim()) {
    // The same address in any casing is the same account, as it is at sign-in.
    return `email:${email.trim().toLowerCase()}`;
  }
  if (typeof challengeToken === 'string' && challengeToken.trim()) {
    return `challenge:${createHash('sha256').update(challengeToken.trim()).digest('hex').slice(0, 32)}`;
  }
  return null;
}
