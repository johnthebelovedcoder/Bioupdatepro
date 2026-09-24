import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@bioassetpro/database';
import type { Response } from 'express';

/**
 * Database errors that are really the caller's mistake, answered as such.
 *
 * Services look records up with `findUniqueOrThrow`, and before this every
 * id that matched nothing — a stale link, a typo, another company's id the
 * ownership guard let through to get the handler's own wording — surfaced as
 * a 500 "Internal server error". That told the user nothing, and it made a
 * harmless bad request look like an outage in the logs.
 *
 * Only codes whose meaning is unambiguous are mapped. Everything else is
 * handed to Nest's default handling unchanged, so a genuine fault still
 * produces a 500 and a stack trace.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const mapped = map(exception);
    if (!mapped || host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }

    this.logger.debug(`${exception.code} → ${mapped.status}: ${exception.message.split('\n').pop()}`);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(mapped.status)
      .json({ statusCode: mapped.status, error: mapped.error, message: mapped.message });
  }
}

function map(
  exception: Prisma.PrismaClientKnownRequestError,
): { status: number; error: string; message: string } | null {
  switch (exception.code) {
    // "An operation failed because it depends on one or more records that
    // were required but not found" — findUniqueOrThrow, update, delete.
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'No such record.' };

    // A malformed id (not a uuid) can never match anything; the answer is
    // the same as for an id that matches nothing.
    case 'P2023':
      return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'No such record.' };

    // Unique constraint. Name the field(s), never the conflicting value.
    case 'P2002': {
      const target = (exception.meta as { target?: string[] | string } | undefined)?.target;
      const fields = Array.isArray(target) ? target.join(', ') : target;
      return {
        status: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: fields
          ? `A record with the same ${fields} already exists.`
          : 'A record with the same details already exists.',
      };
    }

    default:
      return null;
  }
}
