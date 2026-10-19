import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_THROTTLER, LoginThrottlerGuard, accountKey } from '../../src/auth/login-throttle.guard';

/**
 * Which bucket a sign-in attempt is counted in.
 *
 * The bucket used to be the caller, and the caller is the web server for
 * everyone who signs in through the form — so ten attempts per caller was ten
 * per company per fifteen minutes, and one person's typing locked out the
 * farm. It is the account now, with a loose per-caller ceiling left in place
 * to stop somebody working through a list of addresses.
 */
describe('the bucket an authentication attempt is counted in', () => {
  it('is the account, whatever casing or spacing the address arrives in', () => {
    const expected = 'email:ngozi@kajolafarms.ng';
    for (const email of ['ngozi@kajolafarms.ng', 'Ngozi@KajolaFarms.NG', '  ngozi@kajolafarms.ng  ']) {
      expect(accountKey({ body: { email } }), email).toBe(expected);
    }
  });

  it('separates two people signing in at the same moment', () => {
    expect(accountKey({ body: { email: 'ngozi@kajolafarms.ng' } })).not.toBe(
      accountKey({ body: { email: 'chinedu@kajolafarms.ng' } }),
    );
  });

  it('counts a half-finished sign-in against its challenge, not the caller', () => {
    const key = accountKey({ body: { challengeToken: 'a-challenge-token' } });
    expect(key).toMatch(/^challenge:[0-9a-f]{32}$/);
    expect(key).toBe(accountKey({ body: { challengeToken: '  a-challenge-token  ' } }));
    expect(key).not.toBe(accountKey({ body: { challengeToken: 'another-challenge-token' } }));
  });

  /*
   * The authenticator confirmation carries only a six-digit code, so the
   * signed-in user is the only thing identifying it. A farm enrolls everybody
   * on one morning; counted per caller, the sixth person was turned away.
   */
  it('is the signed-in user when the body names nobody', () => {
    expect(accountKey({ user: { userId: 'user-1' }, body: { code: '123456' } })).toBe('user:user-1');
    expect(accountKey({ user: { userId: 'user-1' }, body: { code: '123456' } })).not.toBe(
      accountKey({ user: { userId: 'user-2' }, body: { code: '654321' } }),
    );
  });

  /*
   * An invitation accepted, or a password reset completed: the single-use
   * token in the path is the only identity the request has. A farm's staff
   * accept their invitations on one morning too.
   */
  it('is the single-use token in the path when there is nothing else', () => {
    const key = accountKey({ params: { token: 'an-invitation-token' } });
    expect(key).toMatch(/^token:[0-9a-f]{32}$/);
    expect(key).toBe(accountKey({ params: { token: '  an-invitation-token  ' } }));
    expect(key).not.toBe(accountKey({ params: { token: 'another-invitation-token' } }));
  });

  it('never puts a token itself in the key, which outlives the request', () => {
    expect(accountKey({ body: { challengeToken: 'a-challenge-token' } })).not.toContain('a-challenge-token');
    expect(accountKey({ params: { token: 'an-invitation-token' } })).not.toContain('an-invitation-token');
  });

  it('trusts the signed-in user over anything the body or path claims', () => {
    expect(
      accountKey({
        user: { userId: 'user-1' },
        body: { email: 'somebody.else@kajolafarms.ng' },
        params: { token: 'a-token' },
      }),
    ).toBe('user:user-1');
  });

  it('prefers the email over a challenge or a path token', () => {
    expect(
      accountKey({ body: { email: 'ngozi@kajolafarms.ng', challengeToken: 'x' }, params: { token: 'y' } }),
    ).toBe('email:ngozi@kajolafarms.ng');
  });

  it('names nobody for a request that identifies nobody', () => {
    const requests = [
      null,
      undefined,
      {},
      { body: {} },
      { body: { email: '' } },
      { body: { email: '   ' } },
      { body: { email: 42 } },
      { body: { challengeToken: '' } },
      { body: 'not an object' },
      { user: null },
      { user: { userId: '' } },
      { user: { userId: 7 } },
      { params: {} },
      { params: { token: '' } },
    ];
    for (const request of requests) {
      expect(accountKey(request as never), JSON.stringify(request)).toBeNull();
    }
  });
});

/**
 * The guard itself, driven the way Nest drives it.
 *
 * `accountKey` returning null was the whole story only until the guard had to
 * decide what to do with it. It keyed those attempts on the caller — the web
 * server, for everyone — which rebuilt the shared ten-attempt bucket this
 * guard exists to abolish: a handful of sign-ins posted before the address was
 * typed, or by anything speaking to the API malformed, and the form answered
 * "too many sign-in attempts" to a farm that had barely started its morning.
 */
describe('the guard, over a sequence of attempts', () => {
  it('does not spend the account bucket on requests that name no account', async () => {
    const { attempt } = harness({ accountLimit: 2 });
    for (let i = 1; i <= 5; i += 1) {
      await expect(attempt({ body: {} }), `attempt ${i}`).resolves.toBe(true);
    }
  });

  it('still stops a password being guessed at one address', async () => {
    const { attempt } = harness({ accountLimit: 2 });
    const body = { email: 'ngozi@kajolafarms.ng' };
    await expect(attempt({ body })).resolves.toBe(true);
    await expect(attempt({ body })).resolves.toBe(true);
    await expect(attempt({ body })).rejects.toThrow();
  });

  it('leaves a colleague untouched while one address is locked out', async () => {
    const { attempt } = harness({ accountLimit: 2 });
    for (let i = 0; i < 3; i += 1) {
      await attempt({ body: { email: 'ngozi@kajolafarms.ng' } }).catch(() => undefined);
    }
    await expect(attempt({ body: { email: 'chinedu@kajolafarms.ng' } })).resolves.toBe(true);
  });

  it('still bounds unidentified requests by the caller’s ceiling', async () => {
    const { attempt } = harness({ accountLimit: 2, ceilingLimit: 3 });
    await expect(attempt({ body: {} })).resolves.toBe(true);
    await expect(attempt({ body: {} })).resolves.toBe(true);
    await expect(attempt({ body: {} })).resolves.toBe(true);
    await expect(attempt({ body: {} })).rejects.toThrow();
  });
});

/** A guard wired to counters held in a Map, and one call of `canActivate`. */
function harness({ accountLimit, ceilingLimit = 1_000 }: { accountLimit: number; ceilingLimit?: number }) {
  const hits = new Map<string, number>();
  const storage = {
    async increment(key: string, ttl: number, limit: number) {
      const totalHits = (hits.get(key) ?? 0) + 1;
      hits.set(key, totalHits);
      return { totalHits, timeToExpire: ttl, isBlocked: totalHits > limit, timeToBlockExpire: ttl };
    },
  };
  const options = [
    { name: 'default', ttl: 1_000, limit: 1_000 },
    { name: ACCOUNT_THROTTLER, ttl: 1_000, limit: accountLimit },
    { name: 'ceiling', ttl: 1_000, limit: ceilingLimit },
  ];
  const reflector = { getAllAndOverride: () => undefined };

  const guard = new LoginThrottlerGuard(options as never, storage as never, reflector as never);
  let ready: Promise<void> | null = null;

  return {
    async attempt(request: Record<string, unknown>): Promise<boolean> {
      // Every caller is the web server, which is the point.
      const req = { ip: '10.0.0.7', headers: {}, ...request };
      const context = {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: () => undefined }) }),
        getHandler: () => function login() {},
        getClass: () => class AuthController {},
      } as unknown as ExecutionContext;
      ready ??= guard.onModuleInit();
      await ready;
      return guard.canActivate(context);
    },
  };
}
