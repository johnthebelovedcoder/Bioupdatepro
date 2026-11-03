import { headers } from 'next/headers';

export async function getAppOrigin(): Promise<string> {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) return parseOrigin(configuredOrigin);

  const requestHeaders = await headers();
  const requestOrigin = requestHeaders.get('origin');
  if (requestOrigin) return parseOrigin(requestOrigin);

  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) {
    throw new Error('Set NEXT_PUBLIC_APP_URL to the public address of this app.');
  }
  const forwardedHost = host.split(',')[0]?.trim();
  const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
  return parseOrigin(`${protocol}://${forwardedHost}`);
}

function parseOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL must use HTTP or HTTPS.');
  }
  return url.origin;
}
