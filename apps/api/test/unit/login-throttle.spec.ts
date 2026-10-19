import { describe, expect, it } from 'vitest';
import { accountKey } from '../../src/auth/login-throttle.guard';

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

  it('names nobody for a request that identifies nobody, so the caller’s own bucket is used', () => {
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
