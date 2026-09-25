import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@bioassetpro/database';

/**
 * UAT-010 / UAT-016: a placement or transfer that would put more animals in a
 * house or pen than it holds is refused, and says what would fit.
 *
 * Occupancy is the live count of every active batch in it, less `excluding`
 * (the batch being moved, when it is already there).
 */
export async function assertPenRoom(
  tx: Prisma.TransactionClient,
  companyId: string,
  pen: { id: string; code: string; name: string; capacity: number | null },
  adding: number,
  excluding?: string,
): Promise<void> {
  if (pen.capacity === null || adding <= 0) return;
  const occupied = await tx.livestockGroup.aggregate({
    where: { companyId, penHouseId: pen.id, status: 'ACTIVE', ...(excluding ? { id: { not: excluding } } : {}) },
    _sum: { population: true },
  });
  const inside = occupied._sum.population ?? 0;
  if (inside + adding > pen.capacity) {
    const room = Math.max(0, pen.capacity - inside);
    throw new BadRequestException(
      `${pen.name} holds ${pen.capacity.toLocaleString('en-NG')} and has ${inside.toLocaleString('en-NG')} in it; ` +
        `adding ${adding.toLocaleString('en-NG')} would make ${(inside + adding).toLocaleString('en-NG')}. ` +
        (room > 0 ? `Put ${room.toLocaleString('en-NG')} or fewer here, or choose another house.` : 'Choose another house.'),
    );
  }
}
