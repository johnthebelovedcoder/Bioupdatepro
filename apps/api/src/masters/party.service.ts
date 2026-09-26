import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

/**
 * Long enough for a create plus its audit record on a cold connection pool.
 * The 5s default failed the first item created after a restart.
 */
const TRANSACTION_OPTIONS = { timeout: 20_000 };

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

  /**
   * The company's own defaults, so a registration form does not have to ask
   * for them. Currency in particular: the answer is never anything but the
   * company's base currency, and asking is how a wrong one gets chosen.
   */
  async companyDefaults(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrencyId: true },
    });
  }

  /**
   * INT-001: "Duplicate TIN/bank" must never happen — one TIN is one party,
   * and one bank account belongs to one supplier. A second record for the
   * same business is how a payment gets made twice or diverted.
   */
  private async assertUniqueParty(kind: 'supplier' | 'customer', companyId: string, tin?: string | null, accountNumber?: string | null, excludeId?: string) {
    const notSelf = excludeId ? { id: { not: excludeId } } : {};
    const label = kind === 'supplier' ? 'supplier' : 'customer';
    const model = (kind === 'supplier' ? this.prisma.supplier : this.prisma.customer) as unknown as {
      findFirst: (args: unknown) => Promise<{ code: string; name: string } | null>;
    };
    if (tin?.trim()) {
      const clash = await model.findFirst({ where: { companyId, ...notSelf, tin: tin.trim() }, select: { code: true, name: true } });
      if (clash) {
        throw new AccountingRuleViolation('INT-001 — Duplicate TIN', `TIN ${tin.trim()} is already ${label} ${clash.code} (${clash.name}).`, { code: clash.code });
      }
    }
    if (accountNumber?.trim()) {
      const clash = await model.findFirst({ where: { companyId, ...notSelf, accountNumber: accountNumber.trim() }, select: { code: true, name: true } });
      if (clash) {
        throw new AccountingRuleViolation('INT-001 — Duplicate bank account', `Account ${accountNumber.trim()} is already ${label} ${clash.code}'s (${clash.name}).`, { code: clash.code });
      }
    }
  }

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

    await this.assertUniqueParty('supplier', input.companyId, input.tin, input.accountNumber);

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
          ...(input.accountNumber?.trim() ? { bankSetById: input.actorId, bankSetAt: new Date() } : {}),
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
    }, TRANSACTION_OPTIONS);
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
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Change a supplier's bank details (INT-001). The change is recorded
   * against whoever made it, and clears the verification — the database
   * does too — so nothing is paid by transfer until someone else checks the
   * new account.
   */
  async setSupplierBank(params: {
    companyId: string;
    supplierId: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
    reason: string;
    actorId: string;
  }) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: params.supplierId, companyId: params.companyId } });
    if (!supplier) throw new NotFoundException('No such supplier.');
    const bankName = params.bankName?.trim();
    const accountNumber = params.accountNumber?.trim();
    const accountName = params.accountName?.trim();
    if (!bankName || !accountNumber || !accountName) {
      throw new AccountingRuleViolation('INT-001 — Bank details', 'Give the bank, the account number and the account name.', {});
    }
    if (!params.reason?.trim()) {
      throw new AccountingRuleViolation('INT-001 — Bank change', 'Say why the bank details are changing, and on whose instruction.', {});
    }
    await this.assertUniqueParty('supplier', params.companyId, null, accountNumber, supplier.id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id: supplier.id },
        data: { bankName, accountNumber, accountName, bankSetById: params.actorId, bankSetAt: new Date() },
      });
      await this.writeAudit(tx, {
        entityType: 'Supplier',
        entityId: supplier.id,
        action: AuditAction.UPDATE,
        userId: params.actorId,
        status: 'BANK_UNVERIFIED',
        comments: `Bank details changed from ${supplier.bankName ?? '—'} ${maskAccount(supplier.accountNumber)} to ${bankName} ${maskAccount(accountNumber)}: ${params.reason.trim()}. Awaiting verification.`,
      });
      return updated;
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Verify a supplier's bank details (INT-005): confirmed with the supplier
   * by someone other than whoever entered them, with a record of how.
   */
  async verifySupplierBank(params: { companyId: string; supplierId: string; reference: string; actorId: string }) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: params.supplierId, companyId: params.companyId } });
    if (!supplier) throw new NotFoundException('No such supplier.');
    if (!supplier.accountNumber) throw new AccountingRuleViolation('INT-005 — Bank verification', `${supplier.code} has no bank account to verify.`, {});
    if (supplier.bankVerifiedAt) throw new AccountingRuleViolation('INT-005 — Bank verification', `${supplier.code}'s bank details are already verified.`, {});
    if (!params.reference?.trim()) {
      throw new AccountingRuleViolation('INT-005 — Bank verification', 'Say how the account was confirmed — a call-back to a known number, a bank letter, a test transfer.', {});
    }
    if (supplier.bankSetById === params.actorId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) {
        throw new ForbiddenException('You entered these bank details, so someone else verifies them.');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id: supplier.id },
        data: { bankVerifiedById: params.actorId, bankVerifiedAt: new Date(), bankVerificationReference: params.reference.trim() },
      });
      await this.writeAudit(tx, {
        entityType: 'Supplier',
        entityId: supplier.id,
        action: AuditAction.APPROVE,
        userId: params.actorId,
        status: 'BANK_VERIFIED',
        comments: `Bank details ${supplier.bankName ?? ''} ${maskAccount(supplier.accountNumber)} verified: ${params.reference.trim()}.`,
      });
      return updated;
    }, TRANSACTION_OPTIONS);
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

    await this.assertUniqueParty('customer', input.companyId, input.tin, null);

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
    }, TRANSACTION_OPTIONS);
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
    }, TRANSACTION_OPTIONS);
  }

  /**
   * §6 Customer Credit Control.
   *
   * Checked before a sales order is approved. Every failing condition is
   * reported, not just the first — a salesperson told only "over limit" will
   * fix the limit and hit the block next, and the round trip helps nobody.
   *
   * OUTSTANDING BALANCE: since Phase 10 put the customer dimension on the GL
   * line, this is the customer's own posted movement rather than a company-wide
   * control-account figure. It is a NET position, not an open-item total —
   * invoice-level allocation arrives with Order-to-Cash in Phase 8, and until
   * then a receipt offsets exposure without being matched to the invoice it
   * settled. That is the right number for a credit limit either way.
   */
  async creditCheck(params: {
    customerId: string;
    proposedAmount: Kobo;
    /**
     * Optional fallback for callers that predate the customer dimension. When
     * omitted — which is now the normal case — the balance comes from journal
     * lines carrying this customer.
     */
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

    const movement = await this.prisma.journalLine.aggregate({
      where: {
        customerId: params.customerId,
        journalEntry: { status: 'POSTED', companyId: customer.companyId },
        ...(params.receivableGlAccountId
          ? { glAccountId: params.receivableGlAccountId }
          : {}),
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const outstanding =
      (movement._sum.debitKobo ?? 0n) - (movement._sum.creditKobo ?? 0n);

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

/** Only the last four digits of an account number go into the audit trail. */
function maskAccount(accountNumber: string | null | undefined): string {
  if (!accountNumber) return '—';
  return accountNumber.length <= 4 ? accountNumber : `••••${accountNumber.slice(-4)}`;
}
