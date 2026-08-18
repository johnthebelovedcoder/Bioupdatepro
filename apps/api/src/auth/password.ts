import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing on Node's built-in scrypt.
 *
 * scrypt is memory-hard and in core, which matters here: every native module
 * this project has pulled in has been a source of install trouble, and a
 * password KDF is not somewhere to accept a fragile dependency. The stored
 * format is self-describing so the parameters can be raised later without
 * invalidating existing hashes.
 */

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const FORMAT = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${FORMAT}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [format, saltHex, hashHex] = stored.split('$');
  if (format !== FORMAT || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);

  // Constant time: a length mismatch alone must not short-circuit.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
