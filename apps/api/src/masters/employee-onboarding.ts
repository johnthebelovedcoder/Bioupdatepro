/**
 * The document pack (Employee_Documents): each check HR makes before an
 * employee is accepted, and which of them can never be "not applicable".
 */
export const VERIFICATION_CHECKS = [
  { code: 'CONTRACT', label: 'Signed contract / offer letter' },
  { code: 'BANK', label: 'Bank account (name matches, account confirmed)' },
  { code: 'TAX_ID', label: 'Tax ID (TIN)' },
  { code: 'NIN', label: 'National identity number' },
  { code: 'PENSION', label: 'Pension RSA and PFA' },
  { code: 'NHF', label: 'NHF number' },
  { code: 'NHIA', label: 'Health insurance (NHIA)' },
  { code: 'ADDRESS', label: 'Address' },
  { code: 'EMERGENCY_CONTACT', label: 'Emergency contact / next of kin' },
] as const;

export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number]['code'];
export const VERIFICATION_STATUSES = ['VERIFIED', 'NOT_APPLICABLE', 'OUTSTANDING'] as const;

/** Checks that must be VERIFIED — never waived — for this employee. */
export function requiredChecks(employee: { pensionEnrolled: boolean; nhfEnrolled: boolean }): VerificationCheck[] {
  return [
    'CONTRACT',
    'BANK',
    'TAX_ID',
    ...(employee.pensionEnrolled ? (['PENSION'] as const) : []),
    ...(employee.nhfEnrolled ? (['NHF'] as const) : []),
  ];
}

/**
 * What still stands between this employee and a complete pack: every check
 * answered (verified, or not applicable), and the required ones verified.
 */
export function documentPackGaps(
  employee: { pensionEnrolled: boolean; nhfEnrolled: boolean },
  verifications: Array<{ checkType: string; status: string }>,
): string[] {
  const byType = new Map(verifications.map((v) => [v.checkType, v.status]));
  const required = new Set<string>(requiredChecks(employee));
  const gaps: string[] = [];
  for (const check of VERIFICATION_CHECKS) {
    const status = byType.get(check.code);
    if (required.has(check.code)) {
      if (status !== 'VERIFIED') gaps.push(`${check.label} not verified`);
    } else if (status !== 'VERIFIED' && status !== 'NOT_APPLICABLE') {
      gaps.push(`${check.label} outstanding`);
    }
  }
  return gaps;
}
