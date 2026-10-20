import { Injectable } from '@nestjs/common';

const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

interface FailureWindow {
  count: number;
  expiresAt: number;
}

@Injectable()
export class LoginFailureLimiter {
  private readonly failuresByEmail = new Map<string, FailureWindow>();

  retryAfter(email: string): number {
    const window = this.currentWindow(email, Date.now());
    return window && window.count >= MAX_FAILED_ATTEMPTS
      ? Math.max(1, Math.ceil((window.expiresAt - Date.now()) / 1000))
      : 0;
  }

  recordFailure(email: string): void {
    const now = Date.now();
    const window = this.currentWindow(email, now);
    if (window) {
      window.count = Math.min(window.count + 1, MAX_FAILED_ATTEMPTS);
      return;
    }
    this.failuresByEmail.set(this.key(email), {
      count: 1,
      expiresAt: now + WINDOW_MS,
    });
  }

  clear(email: string): void {
    this.failuresByEmail.delete(this.key(email));
  }

  private currentWindow(email: string, now: number): FailureWindow | undefined {
    const key = this.key(email);
    const window = this.failuresByEmail.get(key);
    if (!window) return undefined;
    if (window.expiresAt <= now) {
      this.failuresByEmail.delete(key);
      return undefined;
    }
    return window;
  }

  private key(email: string): string {
    return email.trim().toLowerCase();
  }
}
