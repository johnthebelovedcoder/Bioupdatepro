import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@bioassetpro/database';

/**
 * Controlled references (Numbering_Parameters, Transaction_Number_Master).
 *
 *   TYPE-ENTITY-SITE-YYYY-SEQ      e.g. PO-AGR-LAG-2026-000001
 *
 * TYPE is an approved prefix from DOCUMENT_TYPES — never free text. ENTITY is
 * the company's three-letter reference code; SITE the farm's or branch's code;
 * YYYY the year of the transaction's own date; SEQ a six-digit counter per
 * company, type, site and year, incremented atomically in the database
 * (INSERT … ON CONFLICT … RETURNING), so two people posting at the same moment
 * never share a number, and a trigger stops a sequence ever going back, so no
 * number is reused. The reference is given at the controlled step — posting,
 * approval, creation of the document — and is not editable afterwards.
 */

export const DOCUMENT_TYPES = {
  PR: 'Purchase requisition',
  RFQ: 'Request for quotation',
  PO: 'Purchase order',
  GRN: 'Goods receipt',
  SIV: 'Supplier invoice',
  PV: 'Payment voucher',
  WTR: 'Warehouse transfer',
  STA: 'Stock adjustment',
  PRO: 'Production order',
  QUO: 'Sales quotation',
  SO: 'Sales order',
  DN: 'Delivery note',
  INV: 'Customer invoice',
  RCT: 'Receipt',
  CN: 'Credit note',
  RTN: 'Sales return',
  PAY: 'Payroll run',
  PPV: 'Payroll payment',
  JV: 'Journal voucher',
  VAL: 'Valuation event',
  WGT: 'Weighing',
  SRN: 'Supplier return',
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

type Client = Prisma.TransactionClient | PrismaClient;

export async function nextReference(
  client: Client,
  params: { companyId: string; type: DocumentType; site: string; date: Date },
): Promise<string> {
  if (!(params.type in DOCUMENT_TYPES)) {
    throw new BadRequestException(`"${params.type}" is not an approved document prefix.`);
  }
  const company = await client.company.findUniqueOrThrow({
    where: { id: params.companyId },
    select: { referenceCode: true, code: true },
  });
  const entity = company.referenceCode ?? codeOf(company.code, 3);
  const site = codeOf(params.site, 6);
  const year = params.date.getUTCFullYear();

  const rows = await client.$queryRaw<Array<{ last_value: number }>>`
    INSERT INTO document_sequences (id, company_id, prefix, site_code, year, last_value, updated_at)
    VALUES (gen_random_uuid(), ${params.companyId}::uuid, ${params.type}, ${site}, ${year}, 1, now())
    ON CONFLICT (company_id, prefix, site_code, year)
    DO UPDATE SET last_value = document_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  const sequence = Number(rows[0]!.last_value);
  return `${params.type}-${entity}-${site}-${year}-${String(sequence).padStart(6, '0')}`;
}

/** Upper-case letters and digits only, at most `length` of them — never empty. */
function codeOf(value: string, length: number): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, length);
  return cleaned || 'XXX';
}

/** The site of a document: its farm's code where it has one, else its branch's. */
export async function siteOf(client: Client, params: { farmId?: string | null; branchId?: string | null }): Promise<string> {
  if (params.farmId) {
    const farm = await client.farm.findUnique({ where: { id: params.farmId }, select: { code: true } });
    if (farm) return farm.code;
  }
  if (params.branchId) {
    const branch = await client.branch.findUnique({ where: { id: params.branchId }, select: { code: true } });
    if (branch) return branch.code;
  }
  return 'HQ';
}
