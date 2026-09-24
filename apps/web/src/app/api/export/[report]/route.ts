import { NextResponse } from 'next/server';
import { getToken } from '@/lib/session';

/**
 * CSV downloads for the financial reports.
 *
 * The API already builds each export from the same rows its screen shows —
 * no second computation path — but it needs a bearer token, and the browser
 * deliberately never holds one. So a download link points here: same-origin,
 * so the session cookie arrives; server-side, so the token is attached; and
 * a pass-through, so the API alone decides who may export what.
 *
 * Only the named reports are forwarded, with only their own filters, so this
 * can never be turned into a general proxy onto the API.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const REPORTS: Record<string, { path: string; filters: string[]; filename: string }> = {
  'trial-balance': {
    path: '/reporting/trial-balance/export',
    filters: ['financialYearId', 'financialPeriodId', 'branchId', 'costCentreId', 'farmId'],
    filename: 'trial-balance',
  },
  'profit-loss': {
    path: '/reporting/profit-loss/export',
    filters: ['financialYearId', 'financialPeriodId', 'branchId', 'costCentreId', 'farmId'],
    filename: 'profit-and-loss',
  },
  'balance-sheet': {
    path: '/reporting/balance-sheet/export',
    filters: ['branchId', 'costCentreId', 'farmId'],
    filename: 'balance-sheet',
  },
  'cash-flow': {
    path: '/reporting/cash-flow/export',
    filters: ['financialPeriodId'],
    filename: 'cash-flow',
  },
  'ar-ageing': { path: '/reporting/ar-ageing/export', filters: [], filename: 'ar-ageing' },
  'ap-ageing': { path: '/reporting/ap-ageing/export', filters: [], filename: 'ap-ageing' },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;
  const spec = REPORTS[report];
  if (!spec) return NextResponse.json({ message: 'No such report.' }, { status: 404 });

  const token = await getToken();
  if (!token) return NextResponse.json({ message: 'Sign in first.' }, { status: 401 });

  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const name of spec.filters) {
    const value = incoming.get(name);
    if (value) query.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${spec.path}${query.size ? `?${query}` : ''}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Cannot reach the API.' }, { status: 502 });
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    return NextResponse.json(
      { message: (detail as { message?: string } | null)?.message ?? 'Export refused.' },
      { status: response.status },
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(await response.text(), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${spec.filename}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
