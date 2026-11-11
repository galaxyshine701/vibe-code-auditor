export const MAX_WRONG_ATTEMPTS = 10;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;

/**
 * Counts WRONG access codes per client, in memory only (a restart clears it).
 * A client with MAX_WRONG_ATTEMPTS wrong tries inside the window is blocked
 * until the oldest of those tries is older than the window.
 */
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly max: number = MAX_WRONG_ATTEMPTS,
    private readonly windowMs: number = ATTEMPT_WINDOW_MS,
    private readonly now: () => number = Date.now,
    private readonly maxClients: number = MAX_TRACKED_CLIENTS,
  ) {}

  /** Seconds to wait, or 0 when the client may try. */
  retryAfterSeconds(client: string): number {
    const recent = this.recent(client);
    if (recent.length < this.max) return 0;
    return Math.max(
      1,
      Math.ceil((recent[0] + this.windowMs - this.now()) / 1000),
    );
  }

  recordFailure(client: string): void {
    const recent = this.recent(client);
    recent.push(this.now());
    this.attempts.set(client, recent);
    if (this.attempts.size > this.maxClients) this.makeRoom();
  }

  private recent(client: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.attempts.get(client) ?? []).filter((t) => t > cutoff);
    if (recent.length === 0) this.attempts.delete(client);
    return recent;
  }

  /** Keeps memory bounded when many different clients send wrong codes. */
  private makeRoom(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [client, times] of this.attempts) {
      if (times[times.length - 1] <= cutoff) this.attempts.delete(client);
    }
    while (this.attempts.size > this.maxClients) {
      const oldest = this.attempts.keys().next().value;
      if (oldest === undefined) break;
      this.attempts.delete(oldest);
    }
  }
}
