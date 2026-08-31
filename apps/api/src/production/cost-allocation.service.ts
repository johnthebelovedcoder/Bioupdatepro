import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { allocateKobo, Kobo } from '../common/money';
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
}

export interface AllocatedOutput {
  itemId: string;
  outputType: 'MAIN' | 'BY_PRODUCT';
  quantity: string;
  allocationWeightKobo: string;
  allocatedCostKobo: string;
}

/**
 * Splits one order's residual WIP cost across its joint/by-product outputs
 * (US-897-019).
 *
 * The addendum names five methods; the client's own approved posting rules
 * (PCR-057/079 — "Allocated standard joint cost using approved NRV method")
 * name NRV specifically, so that is the one this pass actually implements,
 * plus the trivial WEIGHT case. The other three throw rather than fake a
 * result — same honesty this codebase already applies everywhere a spec
 * names something with no data behind it yet.
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

    const weights = params.outputs.map((output, index) => this.weightOf(params.method, output, index));

    if (weights.every((w) => w.isZero())) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §9 — Joint-cost allocation',
        `Every output has a zero allocation weight under the ${params.method} method, so there is ` +
          'no basis to split the order\'s cost across them.',
        { method: params.method },
      );
    }

    const allocated = allocateKobo(params.totalKobo, weights);

    return params.outputs.map((output, index) => ({
      itemId: output.itemId,
      outputType: output.outputType,
      quantity: new Decimal(output.quantity).toFixed(6),
      allocationWeightKobo: BigInt(
        (weights[index] ?? new Decimal(0)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0),
      ).toString(),
      allocatedCostKobo: (allocated[index] ?? 0n).toString(),
    }));
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

    throw new AccountingRuleViolation(
      'Consolidated Reference §9 — Joint-cost allocation',
      `The ${method} allocation method is named in the addendum but not yet implemented — ` +
        'only NRV (the method the client\'s own approved posting rules actually name) and WEIGHT exist so far.',
      { method },
    );
  }
}
