import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  PartyStatus,
  Prisma,
  TaxType,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { Kobo } from '../common/money';

export interface CreditCheckResult {
  passed: boolean;
  customerCode: string;
  status: PartyStatus;
  creditLimitKobo: string | null;
  outstandingKobo: string;
  proposedKobo: string;
  availableKobo: string | null;
  reasons: string[];
}

/**
 * Supplier and Customer masters (§5, §6).
 *
 * Both carry a WHT category that points at a Phase 3 TaxCode rather than
 * naming a rate. That indirection is the point: when a withholding rate
 * changes, it changes in one effective-dated table and every party follows.
 */
@Injectable()
export class PartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Supplier
  // -------------------------------------------------------------------------

  async createSupplier(input: {
    companyId: string;
    code: string;
    name: string;
    category?: string | null;
    tin?: string | null;
    vatRegistrationNumber?: string | null;
    whtTaxCode?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    bankName?: string | null;
    accountNumber?: string | null;
    accountName?: string | null;
    paymentTermCode?: string | null;
    creditLimit?: Kobo | null;
    defaultCurrencyId: string;
    branchId?: string | null;
    defaultCostCentreId?: string | null;
    actorId: string;
  }) {
    const whtTaxCodeId = input.whtTaxCode
      ? await this.resolveTaxCode(input.companyId, input.whtTaxCode, TaxType.WHT)
      : null;
    const paymentTermId = input.paymentTermCode
      ? await this.resolvePaymentTerm(input.companyId, input.paymentTermCode)
      : null;

    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          companyId: input.companyId,
          code: input.code,
          name: input.name,
          category: input.category ?? null,
          tin: input.tin ?? null,
          vatRegistrationNumber: input.vatRegistrationNumber ?? null,
          whtTaxCodeId,
          contactPerson: input.contactPerson ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          bankName: input.bankName ?? null,
          accountNumber: input.accountNumber ?? null,
          accountName: input.accountName ?? null,
          paymentTermId,
          creditLimitKobo: input.creditLimit ?? 0n,
          creditLimitSet: input.creditLimit !== undefined && input.creditLimit !== null,
          defaultCurrencyId: input.defaultCurrencyId,
          branchId: input.branchId ?? null,
          defaultCostCentreId: input.defaultCostCentreId ?? null,
        },
      });

      await this.writeAudit(tx, {
        entityType: 'Supplier',
        entityId: supplier.id,
        action: AuditAction.CREATE,
        userId: input.actorId,
        status: supplier.status,
        comments: `Created supplier ${supplier.code} — ${supplier.name}.`,
      });

      return supplier;
    });
  }

  /**
   * Change a party's status. Blocking requires a reason.
   *
   * §5 and §6 both make Blocked a transacting gate rather than a label, so the
   * question "why can we not raise a PO for this supplier" has to have an
   * answer recorded somewhere other than someone's memory.
   */
  async setSupplierStatus(params: {
    supplierId: string;
    status: PartyStatus;
    reason?: string | null;
    actorId: string;
  }) {
    if (params.status === PartyStatus.BLOCKED && !params.reason?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier status',
        `Blocking a supplier requires a reason. A block with no stated cause cannot be ` +
          `reviewed or lifted with confidence.`,
        { supplierId: params.supplierId },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id: params.supplierId },
        data: { status: params.status, statusReason: params.reason ?? null },
      });

      await this.writeAudit(tx, {
        entityType: 'Supplier',
        entityId: supplier.id,
        action: AuditAction.UPDATE,
        userId: params.actorId,
        status: supplier.status,
        comments: `Status set to ${params.status}${params.reason ? `: ${params.reason}` : ''}.`,
      });

      return supplier;
    });
  }

  async listSuppliers(companyId: string, status?: PartyStatus) {
    return this.prisma.supplier.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { code: 'asc' },
      include: {
        whtTaxCode: { select: { code: true, whtCategory: true } },
        paymentTerm: { select: { code: true, netDays: true } },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Customer
  // -------------------------------------------------------------------------

  async createCustomer(input: {
    companyId: string;
    code: string;
    name: string;
    category?: string | null;
    tin?: string | null;
    vatRegistrationNumber?: string | null;
    whtTaxCode?: string | null;
    contactPerson?: string | null;
    telephone?: string | null;
    email?: string | null;
    address?: string | null;
    state?: string | null;
    country?: string | null;
    paymentTermCode?: string | null;
    creditLimit?: Kobo | null;
    currencyId: string;
    defaultBranchId?: string | null;
    defaultCostCentreId?: string | null;
    customerSince?: Date | null;
    riskRating?: string | null;
    actorId: string;
  }) {
    const whtTaxCodeId = input.whtTaxCode
      ? await this.resolveTaxCode(input.companyId, input.whtTaxCode, TaxType.WHT)
      : null;
    const paymentTermId = input.paymentTermCode
      ? await this.resolvePaymentTerm(input.companyId, input.paymentTermCode)
      : null;

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          companyId: input.companyId,
          code: input.code,
          name: input.name,
          category: input.category ?? null,
          tin: input.tin ?? null,
          vatRegistrationNumber: input.vatRegistrationNumber ?? null,
          whtTaxCodeId,
          contactPerson: input.contactPerson ?? null,
          telephone: input.telephone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          state: input.state ?? null,
          country: input.country ?? 'Nigeria',
          paymentTermId,
          creditLimitKobo: input.creditLimit ?? 0n,
          creditLimitSet: input.creditLimit !== undefined && input.creditLimit !== null,
          currencyId: input.currencyId,
          defaultBranchId: input.defaultBranchId ?? null,
          defaultCostCentreId: input.defaultCostCentreId ?? null,
          customerSince: input.customerSince ?? null,
          riskRating: input.riskRating ?? null,
        },
      });

      await this.writeAudit(tx, {
        entityType: 'Customer',
        entityId: customer.id,
        action: AuditAction.CREATE,
        userId: input.actorId,
        status: customer.status,
        comments: `Created customer ${customer.code} — ${customer.name}.`,
      });

      return customer;
    });
  }

  async setCustomerStatus(params: {
    customerId: string;
    status: PartyStatus;
    reason?: string | null;
    actorId: string;
  }) {
    if (params.status === PartyStatus.BLOCKED && !params.reason?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer status',
        `Blocking a customer requires a reason.`,
        { customerId: params.customerId },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: params.customerId },
        data: { status: params.status, statusReason: params.reason ?? null },
      });

      await this.writeAudit(tx, {
        entityType: 'Customer',
        entityId: customer.id,
        action: AuditAction.UPDATE,
        userId: params.actorId,
        status: customer.status,
        comments: `Status set to ${params.status}${params.reason ? `: ${params.reason}` : ''}.`,
      });

      return customer;
    });
  }

  /**
   * §6 Customer Credit Control.
   *
   * Checked before a sales order is approved. Every failing condition is
   * reported, not just the first — a salesperson told only "over limit" will
   * fix the limit and hit the block next, and the round trip helps nobody.
   *
   * OUTSTANDING BALANCE, PHASE 4 SCOPE: the accounts-receivable ledger arrives
   * with Order-to-Cash in Phase 8. Until then the outstanding figure comes from
   * posted GL movement on the customer's receivable control account, which is
   * correct but company-wide rather than per customer. The signature and the
   * decision logic do not change when Phase 8 lands — only where the number is
   * read from — and this method is where that swap happens.
   */
  async creditCheck(params: {
    customerId: string;
    proposedAmount: Kobo;
    receivableGlAccountId?: string | null;
  }): Promise<CreditCheckResult> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: params.customerId },
    });

    const reasons: string[] = [];

    if (customer.status === PartyStatus.BLOCKED) {
      reasons.push(
        `Customer is BLOCKED${customer.statusReason ? `: ${customer.statusReason}` : ''}.`,
      );
    }
    if (customer.status === PartyStatus.INACTIVE) {
      reasons.push('Customer is INACTIVE.');
    }

    let outstanding = 0n;
    if (params.receivableGlAccountId) {
      const movement = await this.prisma.journalLine.aggregate({
        where: {
          glAccountId: params.receivableGlAccountId,
          journalEntry: { status: 'POSTED', companyId: customer.companyId },
        },
        _sum: { debitKobo: true, creditKobo: true },
      });
      outstanding =
        (movement._sum.debitKobo ?? 0n) - (movement._sum.creditKobo ?? 0n);
    }

    const proposed = params.proposedAmount as bigint;
    let available: bigint | null = null;

    if (customer.creditLimitSet) {
      available = customer.creditLimitKobo - outstanding;
      if (outstanding + proposed > customer.creditLimitKobo) {
        reasons.push(
          `Credit limit exceeded: outstanding ${outstanding} kobo plus proposed ` +
            `${proposed} kobo is over the limit of ${customer.creditLimitKobo} kobo.`,
        );
      }
    } else {
      // A customer with no limit set is not a customer with an unlimited one.
      reasons.push(
        'No credit limit has been set for this customer, so the exposure cannot be assessed.',
      );
    }

    return {
      passed: reasons.length === 0,
      customerCode: customer.code,
      status: customer.status,
      creditLimitKobo: customer.creditLimitSet ? customer.creditLimitKobo.toString() : null,
      outstandingKobo: outstanding.toString(),
      proposedKobo: proposed.toString(),
      availableKobo: available !== null ? available.toString() : null,
      reasons,
    };
  }

  async listCustomers(companyId: string, status?: PartyStatus) {
    return this.prisma.customer.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { code: 'asc' },
      include: {
        whtTaxCode: { select: { code: true, whtCategory: true } },
        paymentTerm: { select: { code: true, netDays: true } },
      },
    });
  }

  // -------------------------------------------------------------------------

  private async resolveTaxCode(
    companyId: string,
    code: string,
    expectedType: TaxType,
  ): Promise<string> {
    const taxCode = await this.prisma.taxCode.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (!taxCode) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Tax code "${code}" is not configured. A party cannot reference a code that ` +
          `the tax engine does not own.`,
        { taxCode: code },
      );
    }
    if (taxCode.taxType !== expectedType) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax Engine',
        `Tax code "${code}" is a ${taxCode.taxType} code; a ${expectedType} code is required here.`,
        { taxCode: code, actualType: taxCode.taxType },
      );
    }
    return taxCode.id;
  }

  private async resolvePaymentTerm(companyId: string, code: string): Promise<string> {
    const term = await this.prisma.paymentTerm.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (!term) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Payment terms',
        `Payment term "${code}" is not configured.`,
        { paymentTerm: code },
      );
    }
    return term.id;
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    event: {
      entityType: string;
      entityId: string;
      action: AuditAction;
      userId: string;
      status: string;
      comments: string;
    },
  ): Promise<void> {
    await this.audit.write(
      {
        transactionId: event.entityId,
        module: 'masters',
        entityType: event.entityType,
        entityId: event.entityId,
        status: event.status,
        action: event.action,
        userId: event.userId,
        comments: event.comments,
      },
      tx,
    );
  }
}
