import 'server-only';
import { redirect } from 'next/navigation';
import { getToken } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * An error the API returned, carrying the message it actually gave.
 *
 * The API's refusals are the product's most important output — "invoiced
 * quantity exceeds accepted quantity", "period is closed", "you cannot approve
 * your own document". Flattening those into "Something went wrong" would throw
 * away the one thing the user needs. So the message is preserved verbatim and
 * shown.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Server components render on every navigation; opt in to caching explicitly. */
  cache?: RequestCache;
  /** When false, a 401 throws instead of redirecting (used by the session probe). */
  redirectOnUnauthorised?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  const {
    method = 'GET',
    body,
    cache = 'no-store',
    redirectOnUnauthorised = true,
  } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      cache,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      `Cannot reach the BioAssetPro API at ${API_URL}. Is it running?`,
      0,
    );
  }

  if (response.status === 401 && redirectOnUnauthorised) {
    redirect('/login?expired=1');
  }

  if (!response.ok) {
    const detail = await safeJson(response);
    throw new ApiError(messageFrom(detail, response.status), response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFrom(detail: unknown, status: number): string {
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message: unknown }).message;
    // class-validator returns an array of messages, one per failed rule.
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
  }
  return `The API returned ${status}.`;
}

/** POST that returns the error message rather than throwing — for form actions. */
export async function tryApi<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await api<T>(path, options) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}
