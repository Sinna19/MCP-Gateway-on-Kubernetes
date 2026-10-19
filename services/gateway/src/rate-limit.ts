export interface Limits {
  loginPerEmail: number; // wrong or right, attempts per email per login window
  loginPerIp: number; // attempts per client IP per login window (successful logins give theirs back)
  loginWindowMs: number;
  mcpCallsPerMinute: number; // tools/call per API key
  mcpSessionsPerKey: number; // open /mcp sessions per API key
  chatDailyCap: number; // POST /api/chat per user per UTC day (kept in Postgres, see chat/daily-cap.ts)
}

// dod-check makes 12 MCP requests on its busiest key in a whole run, far below 60.
export const DEFAULT_LIMITS: Limits = { loginPerEmail: 5, loginPerIp: 30, loginWindowMs: 15 * 60_000, mcpCallsPerMinute: 60, mcpSessionsPerKey: 10, chatDailyCap: 200 };

export type Take = { ok: true } | { ok: false; retryAfterSeconds: number };

// Fixed window: the first take of a key starts a window of windowMs; at most `max` takes fit in it.
// Kept in memory, so it is per process: it resets on a restart and only works with one gateway replica (ADR 020).
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): Take {
    const now = this.now();
    const w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true };
    }
    if (w.count >= this.max) return { ok: false, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) };
    w.count++;
    return { ok: true };
  }

  // Give one take back (a successful login should not use up its IP's budget).
  refund(key: string): void {
    const w = this.windows.get(key);
    if (w && w.count > 0) w.count--;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  // Drop finished windows so the map does not grow with every IP and email ever seen.
  sweep(): void {
    const now = this.now();
    for (const [key, w] of this.windows) if (now >= w.resetAt) this.windows.delete(key);
  }

  size(): number {
    return this.windows.size;
  }
}
