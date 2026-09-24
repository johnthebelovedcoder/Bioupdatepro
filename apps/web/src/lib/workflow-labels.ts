/** Plain-English wording shared by every approvals screen. */

/**
 * Plain English for a transaction type.
 *
 * Not decoration: somebody approving a GOODS_RECEIPT is authorising stock and a
 * liability onto the books, and "GOODS RECEIPT" in capitals does not say that.
 * Anything unmapped falls back to the code rather than to a guess.
 */
export function describeTransaction(type: string): string {
  const known: Record<string, string> = {
    PURCHASE_REQUISITION: 'A request to buy something',
    PURCHASE_ORDER: 'An order to a supplier',
    GOODS_RECEIPT: 'Goods arriving — posts stock and GRNI',
    SUPPLIER_INVOICE: "A supplier's bill — clears GRNI, adds VAT",
    SUPPLIER_INVOICE_EXCEPTION: "A supplier's bill that did not match",
    SUPPLIER_PAYMENT: 'Paying a supplier',
    SALES_QUOTATION: 'A quote to a customer',
    SALES_ORDER: 'A customer order',
    SALES_ORDER_CREDIT_OVERRIDE: 'A customer order over their credit limit',
    GOODS_ISSUE: 'Goods leaving — posts cost of sales',
    SALES_INVOICE: 'Billing a customer',
    CUSTOMER_RECEIPT: 'Money received from a customer',
    CREDIT_NOTE: 'Crediting a customer',
    MANUAL_JOURNAL: 'A journal entry',
    PAYROLL_RUN: 'A payroll run',
    PAYROLL_PAYMENT: 'Paying salaries or a statutory remittance',
    FIXED_ASSET_CAPITALISATION: 'A new fixed asset — posts PPE and a payable',
    FIXED_ASSET_DISPOSAL: 'Retiring a fixed asset',
    DEPRECIATION_RUN: "A period's depreciation",
    BA_VALUATION: 'A biological-asset valuation',
    BIOLOGICAL_ASSET_ABNORMAL_MORTALITY: 'An abnormal loss of livestock',
    PRODUCTION_ORDER: 'A processing order',
    PRODUCTION_ORDER_ABNORMAL_LOSS: 'An abnormal processing loss',
    PERIOD_CLOSE: 'Closing an accounting period',
    PERIOD_REOPEN: 'Reopening a closed period',
  };
  return known[type] ?? type.replace(/_/g, ' ').toLowerCase();
}

export function waitedFor(since: string): string {
  const hours = Math.floor((Date.now() - new Date(since).getTime()) / 3_600_000);
  if (!Number.isFinite(hours) || hours < 1) return 'just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
