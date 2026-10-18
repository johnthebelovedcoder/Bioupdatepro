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
describe('the bucket a sign-in attempt is counted in', () => {
  it('is the account, whatever casing or spacing the address arrives in', () => {
    const expected = 'email:ngozi@kajolafarms.ng';
    for (const email of ['ngozi@kajolafarms.ng', 'Ngozi@KajolaFarms.NG', '  ngozi@kajolafarms.ng  ']) {
      expect(accountKey({ email }), email).toBe(expected);
    }
  });

  it('separates two people signing in at the same moment', () => {
    expect(accountKey({ email: 'ngozi@kajolafarms.ng' })).not.toBe(
      accountKey({ email: 'chinedu@kajolafarms.ng' }),
    );
  });

  it('counts the authenticator step against its challenge, not the caller', () => {
    const key = accountKey({ challengeToken: 'a-challenge-token' });
    expect(key).toMatch(/^challenge:[0-9a-f]{32}$/);
    expect(key).toBe(accountKey({ challengeToken: '  a-challenge-token  ' }));
    expect(key).not.toBe(accountKey({ challengeToken: 'another-challenge-token' }));
  });

  it('never puts the challenge token itself in the key, which outlives the request', () => {
    expect(accountKey({ challengeToken: 'a-challenge-token' })).not.toContain('a-challenge-token');
  });

  it('prefers the email when a body somehow carries both', () => {
    expect(accountKey({ email: 'ngozi@kajolafarms.ng', challengeToken: 'x' })).toBe(
      'email:ngozi@kajolafarms.ng',
    );
  });

  it('names no account for a body that identifies none, so the caller’s own bucket is used', () => {
    for (const body of [null, undefined, 'not an object', {}, { email: '' }, { email: '   ' }, { email: 42 }, { challengeToken: '' }]) {
      expect(accountKey(body), JSON.stringify(body)).toBeNull();
    }
  });
});
