import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

/** Render spins a free service down after 15 minutes without inbound traffic. */
const EVERY_MS = 10 * 60 * 1000;
/** Long enough to outlast a cold start, so a ping that wakes a service counts. */
const PING_TIMEOUT_MS = 90 * 1000;

/**
 * Keeps the farm's own services awake while the farm is working.
 *
 * Render stops a free service after 15 quiet minutes, and the next request
 * waits for it to come back — measured at 53 to 56 seconds, which reads as a
 * broken site rather than a slow one. A GitHub Actions workflow was pinging
 * both services every ten minutes to prevent this, except that it wasn't:
 * scheduled workflows are best-effort, and GitHub honoured that ten-minute
 * schedule roughly four times a day. Both services were cold almost all the time, and
 * the workflow's green ticks hid it.
 *
 * So the pinging moves here, where it runs on this process's own clock.
 *
 * It deliberately stops outside working hours. A free workspace gets 750
 * instance hours a month across every free service, and Render suspends all of
 * them for the rest of the month when they run out. Two services held awake
 * around the clock would need about 1,488 — the farm would lose the system
 * entirely, partway through a month, which is far worse than a slow sign-in.
 * Weekdays from 06:00 to 19:00 in Lagos costs about 286 hours per service,
 * 572 for the pair, leaving headroom for deployments and for evening and
 * weekend use to wake a service the ordinary way.
 *
 * This is a workaround for a limit of the free plan, not a property of the
 * application: a paid instance type does not stop, and then none of this is
 * needed. It also cannot wake a service that has already stopped — nothing
 * runs here to do the waking — so the first person in on a Monday still pays
 * one cold start. It keeps the other ninety-nine sign-ins of the day fast.
 */
@Injectable()
export class KeepWarmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeepWarmService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    const targets = this.targets();
    if (targets.length === 0) return;
    this.logger.log(
      `Keeping ${targets.length} service(s) awake ${WINDOW.from}:00-${WINDOW.to}:00 ${WINDOW.zone}, weekdays.`,
    );
    this.timer = setInterval(() => void this.ping(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * The URLs to keep warm, from KEEP_WARM_URLS (comma-separated).
   *
   * Opt-in, so a farm running its own server — or a developer's laptop — never
   * sends traffic it did not ask to send.
   */
  private targets(): string[] {
    return (process.env.KEEP_WARM_URLS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  }

  /** One pass. Failures are logged and dropped: a missed ping costs a cold start, nothing more. */
  async ping(now: Date = new Date()): Promise<number> {
    if (this.running || !withinWorkingHours(now)) return 0;
    this.running = true;
    let reached = 0;
    try {
      for (const url of this.targets()) {
        try {
          await fetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
          reached += 1;
        } catch (caught) {
          this.logger.warn(`Could not reach ${url} to keep it awake: ${String(caught)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return reached;
  }
}

/** When the farm is at work. Lagos keeps no daylight saving, so UTC+1 all year. */
export const WINDOW = { from: 6, to: 19, zone: 'Africa/Lagos', offsetHours: 1 } as const;

/**
 * Whether a moment falls inside the farm's working week, in Lagos time.
 *
 * Computed from the UTC offset rather than a timezone library because Lagos
 * has not observed daylight saving since 1945, so the offset is a constant.
 */
export function withinWorkingHours(now: Date): boolean {
  const lagos = new Date(now.getTime() + WINDOW.offsetHours * 60 * 60 * 1000);
  const day = lagos.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = lagos.getUTCHours();
  return hour >= WINDOW.from && hour < WINDOW.to;
}
