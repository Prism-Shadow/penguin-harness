/**
 * How much of a credit-flow stream may be in flight (frames.ts AckFrame, stream-answer.ts).
 *
 * The window follows the measured delivery: two seconds of what the client acknowledged over
 * the last five, clamped, starting at 64 KiB. Whatever sits in the queues below the socket — an
 * ssh session's receive queue held 1.5–2 MB of one bulk answer on a 10 KB/s link — is then
 * about two seconds of that link, slow or fast, so every other call riding it waits behind
 * seconds of bytes, not minutes. Counts are JS string lengths of the events' `data`, the unit
 * both ends can count without encoding anything.
 */

/** The window's parameters: a starting size, its bounds, and how it follows the rate. */
export const CREDIT_WINDOW = {
  initial: 64 * 1024,
  min: 32 * 1024,
  max: 1024 * 1024,
  /** The window holds this much time of the acknowledged rate. */
  horizonMs: 2_000,
  /** The rate is measured over the acks of this long. */
  sampleMs: 5_000,
  /** A rate measured over less than this is not trusted yet; the window keeps its size. */
  minSpanMs: 250,
} as const;

/** One stream's credit: what was sent, what was acknowledged, and the window between them. */
export class CreditWindow {
  #sent = 0;
  #acked = 0;
  #size: number = CREDIT_WINDOW.initial;
  /** Ack samples, oldest first; the first is the baseline the rate is measured from. */
  readonly #samples: { at: number; acked: number }[] = [];
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** The window now. */
  get size(): number {
    return this.#size;
  }

  /** Data sent and not yet acknowledged. */
  get unacked(): number {
    return this.#sent - this.#acked;
  }

  /** Whether an event of `size` may go now: within the window, or nothing is in flight at all. */
  admits(size: number): boolean {
    return this.unacked === 0 || this.unacked + size <= this.#size;
  }

  /** An event of `size` went out. */
  sent(size: number): void {
    this.#sent += size;
  }

  /** The client has handled `cumulative` in all; the window follows the rate it shows. */
  ack(cumulative: number): void {
    const acked = Math.min(cumulative, this.#sent);
    if (acked <= this.#acked) return;
    this.#acked = acked;
    const at = this.#now();
    this.#samples.push({ at, acked });
    // Keep one sample at or before the measuring span's start: the baseline.
    while (this.#samples.length > 2 && this.#samples[1]!.at <= at - CREDIT_WINDOW.sampleMs) {
      this.#samples.shift();
    }
    const base = this.#samples[0]!;
    const spanMs = at - base.at;
    if (spanMs < CREDIT_WINDOW.minSpanMs) return;
    const perMs = (acked - base.acked) / spanMs;
    this.#size = Math.round(
      Math.min(CREDIT_WINDOW.max, Math.max(CREDIT_WINDOW.min, perMs * CREDIT_WINDOW.horizonMs)),
    );
  }
}
