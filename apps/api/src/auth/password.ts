import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing on Node's built-in scrypt.
 *
 * scrypt is memory-hard and in core, which matters here: every native module
 * this project has pulled in has been a source of install trouble, and a
 * password KDF is not somewhere to accept a fragile dependency.
 *
 * The stored format encodes the cost parameter (N) that produced it —
 * `scrypt$<N>$<salt>$<hash>` — which is the part that actually makes "raise
 * the parameters later without invalidating existing hashes" true rather
 * than aspirational: `verifyPassword` re-derives with whatever N a hash was
 * actually created under, so `DEFAULT_N` can go up in a future pass and
 * every password hashed before that still verifies correctly, without a
 * migration. Hashes from before this format existed (three fields, no N)
 * are the one exception — those were computed under Node's own implicit
 * default, so they parse as `LEGACY_N` rather than failing to verify.
 */

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const FORMAT = 'scrypt';
/** Node's own default cost parameter — what every hash before this format existed was computed under. */
const LEGACY_N = 16384;
/** OWASP's current minimum for scrypt on an interactive login (2^15) — double Node's default, still well under 100ms. */
const DEFAULT_N = 32768;

function maxmemFor(n: number): number {
  // scrypt needs roughly 128 * N * r bytes (r defaults to 8); pad generously
  // so a raised N doesn't also require remembering to raise this by hand.
  return Math.max(32 * 1024 * 1024, 128 * n * 8 * 2);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: DEFAULT_N,
    maxmem: maxmemFor(DEFAULT_N),
  });
  return `${FORMAT}$${DEFAULT_N}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  let format: string | undefined;
  let n: number;
  let saltHex: string | undefined;
  let hashHex: string | undefined;

  if (parts.length === 4) {
    [format, , saltHex, hashHex] = parts;
    n = Number(parts[1]);
  } else {
    // Legacy three-field format: scrypt$salt$hash, no cost parameter stored.
    [format, saltHex, hashHex] = parts;
    n = LEGACY_N;
  }
  if (format !== FORMAT || !saltHex || !hashHex || !Number.isFinite(n) || n < 1) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: n,
    maxmem: maxmemFor(n),
  });

  // Constant time: a length mismatch alone must not short-circuit.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
