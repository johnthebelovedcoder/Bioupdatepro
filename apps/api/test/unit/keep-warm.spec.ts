import { describe, expect, it } from 'vitest';
import { WINDOW, withinWorkingHours } from '../../src/common/keep-warm.service';

/**
 * When the services are held awake.
 *
 * The window is not a preference: a free workspace has 750 instance hours a
 * month across every free service, and Render suspends all of them for the
 * rest of the month once they are spent. Two services held awake around the
 * clock would need about 1,488, so a window that quietly widened — an
 * off-by-one at either end, or weekends slipping in — would not show up as a
 * slow sign-in. It would show up as the farm losing the system in the third
 * week of a month.
 */
const lagos = (iso: string) => new Date(`${iso}+01:00`);

describe('the hours the services are kept awake', () => {
  it('covers a weekday morning through to the end of the afternoon', () => {
    // 2026-10-28 is a Wednesday.
    for (const time of ['06:00:00', '09:30:00', '13:00:00', '18:59:59']) {
      expect(withinWorkingHours(lagos(`2026-10-28T${time}`)), time).toBe(true);
    }
  });

  it('stops at both ends of the working day', () => {
    expect(withinWorkingHours(lagos('2026-10-28T05:59:59'))).toBe(false);
    expect(withinWorkingHours(lagos('2026-10-28T19:00:00'))).toBe(false);
    expect(withinWorkingHours(lagos('2026-10-28T23:30:00'))).toBe(false);
    expect(withinWorkingHours(lagos('2026-10-28T03:00:00'))).toBe(false);
  });

  it('leaves the weekend alone, which is where the headroom comes from', () => {
    // Saturday and Sunday, in the middle of what would be a working day.
    expect(withinWorkingHours(lagos('2026-10-31T12:00:00'))).toBe(false);
    expect(withinWorkingHours(lagos('2026-11-01T12:00:00'))).toBe(false);
    // Monday is back on.
    expect(withinWorkingHours(lagos('2026-11-02T12:00:00'))).toBe(true);
  });

  /*
   * The server's own clock is UTC, an hour behind Lagos. Reading the hour
   * straight off it would start the farm's day at 07:00 Lagos and end it at
   * 20:00 — an hour of the morning unprotected and an hour of the evening
   * paid for.
   */
  it("reads the hour in Lagos, not in the server's own time zone", () => {
    // 05:30 UTC is 06:30 in Lagos: inside the window, though UTC says before.
    expect(withinWorkingHours(new Date('2026-10-28T05:30:00Z'))).toBe(true);
    // 18:30 UTC is 19:30 in Lagos: outside, though UTC says before 19:00.
    expect(withinWorkingHours(new Date('2026-10-28T18:30:00Z'))).toBe(false);
  });

  /*
   * The budget this window exists to protect. Two services, weekdays only:
   * about 286 hours each, 572 for the pair, against 750 for the workspace.
   */
  it("fits two services inside a free workspace's monthly hours", () => {
    const hoursPerDay = WINDOW.to - WINDOW.from;
    const weekdaysPerMonth = 22;
    const services = 2;
    expect(hoursPerDay * weekdaysPerMonth * services).toBeLessThan(750);
  });
});
