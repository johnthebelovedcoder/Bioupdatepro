import { NextResponse } from 'next/server';
import { getToken } from '@/lib/session';

/**
 * The search box's way through to the API.
 *
 * Same seam as `/api/sync`, and for the same reason: the palette runs in the
 * browser and types as you go, but the session token lives in an httpOnly
 * cookie that script deliberately cannot read. This route is same-origin so the
 * cookie arrives automatically, server-side so the token can be attached as a
 * bearer, and a thin pass-through so the API stays the only thing that decides
 * what a given user is allowed to find.
 *
 * A signed-out request returns an empty result rather than a 401. Nothing is
 * being protected by the difference — the API refuses either way — and a search
 * box that throws while somebody is mid-word is a worse thing to explain than
 * one that quietly finds nothing.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function GET(request: Request) {
  const token = await getToken();
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  if (!token || query.length < 2) {
    return NextResponse.json({ query, results: [] });
  }

  try {
    const response = await fetch(
      `${API_URL}/search?q=${encodeURIComponent(query)}&limit=20`,
      { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    if (!response.ok) return NextResponse.json({ query, results: [] });
    return NextResponse.json(await response.json());
  } catch {
    // The API being down should not break typing.
    return NextResponse.json({ query, results: [] });
  }
}
