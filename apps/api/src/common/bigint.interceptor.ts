import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Serialises bigint as a decimal STRING on the way out.
 *
 * JSON has no bigint, so without this every response carrying money throws
 * "Do not know how to serialize a BigInt". The obvious fix — Number(value) — is
 * the wrong one: kobo above 2^53 (₦90 trillion) would silently lose precision,
 * and silent precision loss in a ledger is the exact failure this project is
 * built to prevent. A string is exact and the client parses it back to BigInt.
 *
 * Deliberately an interceptor rather than a patch of BigInt.prototype.toJSON:
 * mutating a global built-in changes behaviour for every library in the process,
 * including ones that might reasonably expect the throw.
 */
@Injectable()
export class BigIntSerialiserInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => convert(value)));
  }
}

function convert(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  // Dates and Prisma Decimals already serialise correctly; walking into them
  // would turn them into meaningless objects.
  if (value instanceof Date) return value;
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value;

  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => convert(item, seen));

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = convert(item, seen);
  }
  return result;
}
