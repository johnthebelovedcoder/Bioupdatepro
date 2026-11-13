import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client';

export function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set before creating a Prisma client.');
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }),
  });
}
