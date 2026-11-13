import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditAction, PaymentFileKind, PaymentMethod, PaymentStatus, PayrollPayableBucket } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowActor } from '../workflow/workflow.types';

/** Who may issue a bank payment file — it carries full account numbers. */
export const PAYMENT_FILE_ROLES = ['TREASURY_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'];

const HEADER = ['Reference', 'Beneficiary name', 'Account number', 'Bank', 'Amount (NGN)', 'Narration', 'Payment number'];

interface Row {
  reference: string;
  name: string;
  accountNumber: string;
  bank: string;
  amountKobo: bigint;
  narration: string;
  paymentNumber: string;
}

/**
 * Bank payment files (SOP-P2P-05 "Cash > Payment Run"; §37 "Treasury releases
 * bank file"). Posted bank-transfer payments that have not yet gone out are
 * gathered into one CSV for the bank's bulk-upload channel: a supplier
 * payment is one row; a salary payment is one row per employee paid in the
 * run. Each payment goes in one file only, and the file's SHA-256 is kept, so
 * the same file can be downloaded again and an altered one recognised.
 *
 * The layout is a plain CSV — reference, beneficiary, account number, bank,
 * amount, narration — which each bank's upload template maps from; there is
 * no direct connection to a bank.
 */
@Injectable()
export class PaymentFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const files = await this.prisma.paymentFile.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return files.map((f) => ({
      id: f.id,
      reference: f.reference,
      kind: f.kind,
      rowCount: f.rowCount,
      totalKobo: f.totalKobo.toString(),
      sha256: f.sha256,
      createdAt: f.createdAt,
    }));
  }

  /** Posted bank transfers not yet in a file, and whether each can go in one. */
  async pending(companyId: string, kind: PaymentFileKind) {
    if (kind === PaymentFileKind.SUPPLIER) {
      const payments = await this.prisma.supplierPayment.findMany({
        where: { companyId, status: PaymentStatus.POSTED, method: PaymentMethod.BANK_TRANSFER, paymentFileId: null },
        orderBy: { paymentNumber: 'asc' },
        include: { supplier: { select: { name: true, bankName: true, accountNumber: true, accountName: true, bankVerifiedAt: true } } },
      });
      return payments.map((p) => ({
        id: p.id,
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate.toISOString().slice(0, 10),
        payee: p.supplier.name,
        amountKobo: p.amountKobo.toString(),
        rows: 1,
        problem: !p.supplier.accountNumber
          ? 'The supplier has no bank account on record.'
          : !p.supplier.bankVerifiedAt
            ? 'The supplier’s bank details changed since and are not verified.'
            : null,
      }));
    }
    const payments = await this.prisma.payrollPayment.findMany({
      where: { companyId, status: PaymentStatus.POSTED, method: PaymentMethod.BANK_TRANSFER, bucket: PayrollPayableBucket.SALARY, paymentFileId: null },
      orderBy: { paymentNumber: 'asc' },
      include: { payrollRun: { select: { id: true } } },
    });
    const out = [];
    for (const p of payments) {
      const lines = await this.salaryLines(companyId, p.payrollRun.id);
      const total = lines.reduce((s, l) => s + l.amountKobo, 0n);
      const missing = lines.filter((l) => !l.accountNumber).length;
      out.push({
        id: p.id,
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate.toISOString().slice(0, 10),
        payee: `${lines.length} employees`,
        amountKobo: p.amountKobo.toString(),
        rows: lines.length,
        problem:
          total !== p.amountKobo
            ? 'This payment is not the run’s whole net pay, so it cannot be split by employee.'
            : missing > 0
              ? `${missing} employee${missing === 1 ? ' has' : 's have'} no bank account on record.`
              : null,
      });
    }
    return out;
  }

  async create(params: { companyId: string; kind: PaymentFileKind; paymentIds: string[]; actor: WorkflowActor }) {
    this.assertRole(params.actor);
    const ids = [...new Set(params.paymentIds)];
    if (ids.length === 0) throw new BadRequestException('Choose at least one payment.');
    const pending = await this.pending(params.companyId, params.kind);
    for (const id of ids) {
      const row = pending.find((p) => p.id === id);
      if (!row) throw new BadRequestException('A chosen payment is not a posted bank transfer waiting for a file.');
      if (row.problem) throw new BadRequestException(`${row.paymentNumber}: ${row.problem}`);
    }
    const rows = await this.rowsFor(params.companyId, params.kind, ids);
    const total = rows.reduce((s, r) => s + r.amountKobo, 0n);
    const csv = toCsv(rows);
    const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const sameDay = await this.prisma.paymentFile.count({ where: { companyId: params.companyId, reference: { startsWith: `PF-${day}-` } } });
    const reference = `PF-${day}-${String(sameDay + 1).padStart(3, '0')}`;

    const file = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentFile.create({
        data: { companyId: params.companyId, reference, kind: params.kind, rowCount: rows.length, totalKobo: total, sha256, createdById: params.actor.userId },
      });
      // Stamped only while still unfiled, so two people cannot put a payment in two files.
      const stamped =
        params.kind === PaymentFileKind.SUPPLIER
          ? await tx.supplierPayment.updateMany({ where: { companyId: params.companyId, id: { in: ids }, paymentFileId: null }, data: { paymentFileId: created.id } })
          : await tx.payrollPayment.updateMany({ where: { companyId: params.companyId, id: { in: ids }, paymentFileId: null }, data: { paymentFileId: created.id } });
      if (stamped.count !== ids.length) throw new BadRequestException('A chosen payment went into another file meanwhile. Refresh and try again.');
      return created;
    });
    await this.audit.write({
      transactionId: file.id,
      module: 'banking',
      entityType: 'PaymentFile',
      entityId: file.id,
      status: 'ISSUED',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress,
      device: params.actor.device,
      newValue: { reference, kind: params.kind, payments: ids.length, rows: rows.length, totalKobo: total.toString(), sha256 },
      comments: `Bank payment file ${reference}: ${rows.length} rows, ${total} kobo.`,
    });
    return { id: file.id, reference, rowCount: rows.length, totalKobo: total.toString(), sha256, csv };
  }

  /** The same file again, rebuilt from its payments; says if it no longer matches what was issued. */
  async download(params: { companyId: string; fileId: string; actor: WorkflowActor }) {
    this.assertRole(params.actor);
    const file = await this.prisma.paymentFile.findFirst({ where: { id: params.fileId, companyId: params.companyId } });
    if (!file) throw new NotFoundException('No such payment file.');
    const ids =
      file.kind === PaymentFileKind.SUPPLIER
        ? (await this.prisma.supplierPayment.findMany({ where: { companyId: params.companyId, paymentFileId: file.id }, select: { id: true } })).map((p) => p.id)
        : (await this.prisma.payrollPayment.findMany({ where: { companyId: params.companyId, paymentFileId: file.id }, select: { id: true } })).map((p) => p.id);
    const csv = toCsv(await this.rowsFor(params.companyId, file.kind, ids));
    const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
    await this.audit.write({
      transactionId: file.id,
      module: 'banking',
      entityType: 'PaymentFile',
      entityId: file.id,
      status: 'DOWNLOADED',
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress,
      device: params.actor.device,
      comments: `Downloaded ${file.reference}${sha256 === file.sha256 ? '' : ' — bank details changed since it was issued'}.`,
    });
    return { reference: file.reference, csv, sha256, matchesIssued: sha256 === file.sha256 };
  }

  private assertRole(actor: WorkflowActor) {
    if (!actor.roles.some((r) => PAYMENT_FILE_ROLES.includes(r))) {
      throw new ForbiddenException('Bank payment files carry full account numbers; treasury and finance issue them.');
    }
  }

  private async rowsFor(companyId: string, kind: PaymentFileKind, ids: string[]): Promise<Row[]> {
    if (kind === PaymentFileKind.SUPPLIER) {
      const payments = await this.prisma.supplierPayment.findMany({
        where: { companyId, id: { in: ids } },
        orderBy: { paymentNumber: 'asc' },
        include: { supplier: { select: { name: true, bankName: true, accountNumber: true, accountName: true } } },
      });
      return payments.map((p) => ({
        reference: p.reference ?? p.paymentNumber,
        name: p.supplier.accountName ?? p.supplier.name,
        accountNumber: p.supplier.accountNumber ?? '',
        bank: p.supplier.bankName ?? '',
        amountKobo: p.amountKobo,
        narration: p.narration ?? `Payment ${p.paymentNumber}`,
        paymentNumber: p.paymentNumber,
      }));
    }
    const payments = await this.prisma.payrollPayment.findMany({
      where: { companyId, id: { in: ids } },
      orderBy: { paymentNumber: 'asc' },
      include: { payrollRun: { select: { id: true, reference: true } } },
    });
    const rows: Row[] = [];
    for (const p of payments) {
      for (const line of await this.salaryLines(companyId, p.payrollRun.id)) {
        rows.push({
          reference: `${p.paymentNumber}-${line.employeeNumber}`,
          name: line.name,
          accountNumber: line.accountNumber ?? '',
          bank: line.bank ?? '',
          amountKobo: line.amountKobo,
          narration: `Salary ${p.payrollRun.reference}`,
          paymentNumber: p.paymentNumber,
        });
      }
    }
    return rows;
  }

  private async salaryLines(companyId: string, payrollRunId: string) {
    const lines = await this.prisma.payrollRunLine.findMany({
      where: { payrollRunId, netPayKobo: { gt: 0n }, payrollRun: { companyId } },
      include: { employee: { select: { employeeNumber: true, firstName: true, surname: true, bankName: true, accountNumber: true, accountName: true } } },
    });
    return lines
      .map((l) => ({
        employeeNumber: l.employee.employeeNumber,
        name: l.employee.accountName ?? `${l.employee.firstName} ${l.employee.surname}`,
        accountNumber: l.employee.accountNumber,
        bank: l.employee.bankName,
        amountKobo: l.netPayKobo,
      }))
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
  }
}

function toCsv(rows: Row[]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const naira = (k: bigint) => `${k / 100n}.${String(k % 100n).padStart(2, '0')}`;
  const lines = [HEADER.join(',')];
  for (const r of rows) {
    lines.push([r.reference, r.name, r.accountNumber, r.bank, naira(r.amountKobo), r.narration, r.paymentNumber].map((v) => cell(String(v))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
