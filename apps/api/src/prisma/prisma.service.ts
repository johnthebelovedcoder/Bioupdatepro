import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@bioassetpro/database';

/**
 * Immutability (Rule 2) and the append-only audit trail (Rule 9) are enforced
 * by Postgres triggers, in `packages/database/prisma/sql/010_constraints.sql`.
 *
 * That is deliberately the ONLY enforcement point, and it is the right one:
 * a trigger holds for every connection — this application, a migration script,
 * a future service, or a DBA at a psql prompt. An ORM-level guard protects only
 * the one path that goes through the ORM, which for a financial system is a
 * guarantee about our code rather than about the ledger.
 *
 * The integration suite proves this by attacking the database directly with raw
 * SQL — `UPDATE journal_entries`, `DELETE FROM audit_records` — and asserting
 * that each one is refused. See test/integration/posting.spec.ts.
 *
 * (An earlier revision also registered a Prisma `$use` middleware for friendlier
 * error messages. `$use` was removed in Prisma 6, and the replacement — a client
 * extension — changes the client's type in a way that would ripple through every
 * injection site for no gain in safety. If we want nicer messages later, the
 * place to add them is the PostingService, which is already the single write
 * path into the ledger.)
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Neon's compute suspends after a few minutes idle and takes a handful of
   * seconds to wake on the next connection. A single failed `$connect()` here
   * used to crash the whole process before it ever reached `app.listen()` —
   * taking down every route, not just database ones, until someone noticed
   * and restarted it by hand. Retrying with backoff absorbs that cold start
   * instead of going down for it.
   */
  async onModuleInit(): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Database connected');
        return;
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxAttempts} failed — retrying in ${delayMs}ms (Neon's compute may still be waking up).`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
