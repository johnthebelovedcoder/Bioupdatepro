import { describe, expect, it } from 'vitest';
import { CostAllocationService } from '../../src/production/cost-allocation.service';
import { kobo } from '../../src/common/money';

describe('percentage joint-cost allocation', () => {
  const service = new CostAllocationService();

  it.each(['STANDARD_PERCENTAGE', 'MANUAL'] as const)(
    'allocates exactly in integer kobo using %s percentages',
    (method) => {
      const result = service.allocate({
        method,
        totalKobo: kobo(10_001n),
        outputs: [
          { itemId: 'meat', outputType: 'MAIN', quantity: '1', allocationPercentage: '25' },
          { itemId: 'shell', outputType: 'MAIN', quantity: '1', allocationPercentage: '75' },
        ],
      });

      expect(result.map((output) => output.allocatedCostKobo)).toEqual(['2500', '7501']);
      expect(result.map((output) => output.allocationPercentage)).toEqual(['25.0000', '75.0000']);
      expect(result.reduce((sum, output) => sum + BigInt(output.allocatedCostKobo), 0n)).toBe(10_001n);
    },
  );

  it('requires main-output percentages to total exactly 100%', () => {
    expect(() => service.allocate({
      method: 'MANUAL',
      totalKobo: kobo(1_000n),
      outputs: [
        { itemId: 'meat', outputType: 'MAIN', quantity: '1', allocationPercentage: '40' },
        { itemId: 'shell', outputType: 'MAIN', quantity: '1', allocationPercentage: '59.9999' },
      ],
    })).toThrow(/must total exactly 100%/);
  });

  it('deducts material by-product NRV before applying main-output percentages', () => {
    const result = service.allocate({
      method: 'MANUAL',
      totalKobo: kobo(10_000n),
      outputs: [
        { itemId: 'meat', outputType: 'MAIN', quantity: '1', allocationPercentage: '25' },
        { itemId: 'cuts', outputType: 'MAIN', quantity: '1', allocationPercentage: '75' },
        { itemId: 'offal', outputType: 'BY_PRODUCT', quantity: '2', salePricePerUnitKobo: 1_000n, costsToSellPerUnitKobo: 0n },
      ],
    });

    expect(result.map((output) => output.allocatedCostKobo)).toEqual(['2000', '6000', '2000']);
    expect(result.map((output) => output.allocationPercentage)).toEqual(['25.0000', '75.0000', null]);
    expect(result.reduce((sum, output) => sum + BigInt(output.allocatedCostKobo), 0n)).toBe(10_000n);
  });
});
