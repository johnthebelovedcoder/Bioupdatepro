import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@bioassetpro/database';

export function createPrismaAdapter(): PrismaPg {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set before creating a Prisma client.');
  }

  return new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: createPrismaAdapter() });
}
