import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { allocateKobo, kobo, Kobo } from '../common/money';
import { AccountingRuleViolation } from '../common/errors';

export type CostAllocationMethod =
  | 'NRV'
  | 'WEIGHT'
  | 'SALES_VALUE'
  | 'STANDARD_PERCENTAGE'
  | 'MANUAL';

export interface AllocationOutput {
  itemId: string;
  outputType: 'MAIN' | 'BY_PRODUCT';
  quantity: Decimal.Value;
  /** Required for NRV: sale price per unit. */
  salePricePerUnitKobo?: bigint;
  /** Required for NRV: further cost to sell/finish per unit, subtracted from sale price. */
  costsToSellPerUnitKobo?: bigint;
  /** Required for WEIGHT. */
  weight?: Decimal.Value;
  /** Immaterial by-products carry zero cost and are excluded from the joint-cost pool. */
  isImmaterialByProduct?: boolean;
}

export interface AllocatedOutput {
  itemId: string;
  outputType: 'MAIN' | 'BY_PRODUCT';
  quantity: string;
  allocationWeightKobo: string;
  allocatedCostKobo: string;
  isImmaterialByProduct: boolean;
}

/**
 * Splits one order's residual WIP cost across its joint/by-product outputs
 * (US-897-019).
 *
 * Sales value at split-off is the default joint-product method. By-products
 * are measured at NRV and deducted from the pool before the main-product split.
 *
 * `totalKobo` MUST be the residual WIP after abnormal loss is removed, not
 * an independently priced total — that is what makes Rule 7
 * (`wipDebits === fgCredit + byProductCredit + abnormalLossCredit`) hold by
 * construction rather than by hoping two numbers happen to agree.
 */
@Injectable()
export class CostAllocationService {
  allocate(params: {
    method: CostAllocationMethod;
    totalKobo: Kobo;
    outputs: AllocationOutput[];
  }): AllocatedOutput[] {
    if (params.outputs.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Joint-cost allocation',
        'A production order cannot complete with zero outputs — there is nothing to allocate cost to.',
        {},
      );
    }

    // IAS 2's by-product policy is independent of how the main products are
    // allocated: value material by-products at NRV and deduct it from the
    // joint-cost pool first. Immaterial by-products remain at zero cost and
    // their proceeds are recognized as other operating income on sale.
    if (params.outputs.some((o) => o.outputType === 'BY_PRODUCT')) {
      const byProducts = params.outputs.filter((o) => o.outputType === 'BY_PRODUCT' && !o.isImmaterialByProduct);
      const immaterial = params.outputs.filter((o) => o.outputType === 'BY_PRODUCT' && o.isImmaterialByProduct);
      const mainProducts = params.outputs.filter((o) => o.outputType === 'MAIN');
      if (!mainProducts.length) throw new AccountingRuleViolation('Consolidated Reference §9 — Joint-cost allocation', 'A by-product cannot be the only output in a joint-cost allocation.', {});
      const byProductNrv = byProducts.map((output, index) => {
        if (output.salePricePerUnitKobo === undefined) throw new AccountingRuleViolation('Consolidated Reference §9 — By-product valuation', `By-product ${index + 1} needs an NRV price.`, { method: params.method });
        const nrvPerUnit = new Decimal(output.salePricePerUnitKobo.toString()).minus(new Decimal((output.costsToSellPerUnitKobo ?? 0n).toString()));
        return BigInt((nrvPerUnit.lessThan(0) ? new Decimal(0) : nrvPerUnit).mul(output.quantity).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      });
      const byProductTotal = byProductNrv.reduce((sum, value) => sum + value, 0n);
      const recognizedByProductValue = byProductTotal > params.totalKobo ? params.totalKobo : byProductTotal;
      const mainAllocations = this.allocate({ method: params.method, totalKobo: kobo(params.totalKobo - recognizedByProductValue), outputs: mainProducts });
      let remaining = recognizedByProductValue;
      const byProductAllocations = byProducts.map((output, index) => {
        const value = byProductNrv[index] ?? 0n;
        const allocated = value > remaining ? remaining : value;
        remaining -= allocated;
        return { itemId: output.itemId, outputType: output.outputType, quantity: new Decimal(output.quantity).toFixed(6), allocationWeightKobo: value.toString(), allocatedCostKobo: allocated.toString(), isImmaterialByProduct: false };
      });
      return [...mainAllocations, ...byProductAllocations, ...immaterial.map((output) => ({
        itemId: output.itemId, outputType: output.outputType,
        quantity: new Decimal(output.quantity).toFixed(6), allocationWeightKobo: '0',
        allocatedCostKobo: '0', isImmaterialByProduct: true,
      }))];
    }

    const allocatable = params.outputs.filter((o) => !o.isImmaterialByProduct);
    const weights = allocatable.map((output, index) => this.weightOf(params.method, output, index));

    if (weights.every((w) => w.isZero())) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Joint-cost allocation',
        `Every output has a zero allocation weight under the ${params.method} method, so there is ` +
          'no basis to split the order\'s cost across them.',
        { method: params.method },
      );
    }

    const allocated = allocateKobo(params.totalKobo, weights);

    const allocatedOutputs = allocatable.map((output, index) => ({
      itemId: output.itemId,
      outputType: output.outputType,
      quantity: new Decimal(output.quantity).toFixed(6),
      allocationWeightKobo: BigInt(
        (weights[index] ?? new Decimal(0)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0),
      ).toString(),
      allocatedCostKobo: (allocated[index] ?? 0n).toString(),
      isImmaterialByProduct: false,
    }));
    return [...allocatedOutputs, ...params.outputs.filter((o) => o.isImmaterialByProduct).map((output) => ({
      itemId: output.itemId, outputType: output.outputType,
      quantity: new Decimal(output.quantity).toFixed(6), allocationWeightKobo: '0',
      allocatedCostKobo: '0', isImmaterialByProduct: true,
    }))];
  }

  private weightOf(method: CostAllocationMethod, output: AllocationOutput, index: number): Decimal {
    const quantity = new Decimal(output.quantity);

    if (method === 'WEIGHT') {
      if (output.weight === undefined) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §9 — Joint-cost allocation',
          `Output ${index + 1} needs a weight for the WEIGHT allocation method.`,
          { method },
        );
      }
      return new Decimal(output.weight);
    }

    if (method === 'NRV') {
      if (output.salePricePerUnitKobo === undefined) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §9 — Joint-cost allocation',
          `Output ${index + 1} needs a sale price for the NRV allocation method — the same ` +
            'evidence-backed price a valuation would need, not a guess.',
          { method },
        );
      }
      const netPerUnit = new Decimal(output.salePricePerUnitKobo.toString()).minus(
        new Decimal((output.costsToSellPerUnitKobo ?? 0n).toString()),
      );
      const clamped = netPerUnit.lessThan(0) ? new Decimal(0) : netPerUnit;
      return clamped.mul(quantity);
    }

    if (method === 'SALES_VALUE') {
      if (output.salePricePerUnitKobo === undefined) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §9 — Joint-cost allocation',
          `Output ${index + 1} needs an approved split-off sales price for SALES_VALUE allocation.`,
          { method },
        );
      }
      return new Decimal(output.salePricePerUnitKobo.toString()).mul(quantity);
    }

    throw new AccountingRuleViolation(
      'Consolidated Reference §9 — Joint-cost allocation',
      `The ${method} allocation method is named in the addendum but not yet implemented — ` +
        'only NRV (the method the client\'s own approved posting rules actually name) and WEIGHT exist so far.',
      { method },
    );
  }
}
