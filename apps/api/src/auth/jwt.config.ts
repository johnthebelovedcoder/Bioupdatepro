/**
 * The signing secret. There is deliberately no default: a fallback secret that
 * silently works in development is a fallback secret that silently ships. If
 * JWT_SECRET is unset the API refuses to start.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return secret;
}

/** How long a session lasts before the user signs in again. */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '12h';
