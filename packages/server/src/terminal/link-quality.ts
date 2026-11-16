/**
 * What the stream knows about the link it is writing to: how long a round trip takes, and
 * how fast the viewer's socket actually drains.
 *
 * Both numbers exist because the transport's two constants were tuned on a link with no
 * latency and no bandwidth limit, and both of them mean something different on a phone:
 *
 * - The output merge window (output-coalescer.ts) was a flat 5ms. At a 200ms round trip
 *   that window merges almost nothing while producing hundreds of small frames a second —
 *   pure overhead on a radio, and no faster to arrive, because the round trip dominates by
 *   two orders of magnitude. Scaled to the measured trip it merges properly, and on a fast
 *   link it stays where it was.
 * - The backpressure high-water mark was a flat 1MB. A byte bound is a LAG bound only if
 *   you know the rate: 1MB is a few milliseconds behind on a LAN and the better part of ten
 *   seconds behind on a slow uplink — which is exactly the "output arrives late, then jumps"
 *   complaint. Measured delivery turns it back into the time bound it was meant to be.
 *
 * Both estimators are deliberately conservative: with no measurement yet, they answer with
 * the old constants, so a link that never reports stays on the behaviour it always had.
 */

/** Smoothing for both estimators: the new sample weighs a fifth. */
const ALPHA = 0.2;

export const MIN_COALESCE_WINDOW_MS = 5;
export const MAX_COALESCE_WINDOW_MS = 50;

/**
 * The merge window for a measured round trip: a quarter of it, bounded.
 *
 * A quarter keeps the window an order of magnitude below the delay the user is already
 * paying, so merging is invisible to them, while the ceiling keeps a satellite-grade link
 * from batching output into visible chunks. `null` (nothing measured yet) answers the
 * floor, which is what this server did before it measured anything.
 */
export function coalesceWindowFor(roundTripMs: number | null): number {
  if (roundTripMs === null || !Number.isFinite(roundTripMs)) return MIN_COALESCE_WINDOW_MS;
  const quarter = roundTripMs / 4;
  return Math.min(MAX_COALESCE_WINDOW_MS, Math.max(MIN_COALESCE_WINDOW_MS, Math.round(quarter)));
}

/** Round-trip estimate from Ping/Pong echoes, smoothed so one stalled reply cannot swing it. */
export class RoundTripEstimator {
  private estimate: number | null = null;

  /** Ignores nonsense (a clock that went backwards, an echo of something we never sent). */
  sample(roundTripMs: number): void {
    if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return;
    this.estimate =
      this.estimate === null ? roundTripMs : this.estimate * (1 - ALPHA) + roundTripMs * ALPHA;
  }

  get roundTripMs(): number | null {
    return this.estimate;
  }

  windowMs(): number {
    return coalesceWindowFor(this.estimate);
  }
}

/** How far behind a viewer may fall before the stream skips it ahead with a fresh repaint. */
export const MAX_VIEWER_LAG_MS = 750;
/**
 * Floor and ceiling for the derived high-water mark. The ceiling is the byte bound this
 * server always used, so a link fast enough to drain it keeps its old behaviour; the floor
 * stays clear of the low-water mark, or a viewer would resync on every burst.
 */
export const MIN_HIGH_WATER_BYTES = 128 * 1024;
export const MAX_HIGH_WATER_BYTES = 1024 * 1024;

/** Shortest interval between two throughput samples: below this, one flush is all noise. */
const SAMPLE_INTERVAL_MS = 250;

/**
 * Throughput of one viewer's stream, measured from what has actually left.
 *
 * Every frame reports itself twice — once when it is handed to the socket, once when the
 * socket says it is gone — and the second report is the measurement: bytes delivered per
 * second. It is only taken while something WAS waiting, because a socket with an empty
 * queue delivers exactly as fast as output is produced, and an idle shell would otherwise
 * "measure" a few bytes a second and shrink the viewer's allowance to nothing.
 *
 * Both numbers are in the bytes the terminal produced, never in the bytes the socket wrote:
 * the stream is compressed on the wire, and the lag a viewer feels is measured in the
 * output it has not seen yet.
 */
export class SocketDrainMeter {
  private delivered = 0;
  private lastSampleAt: number | null = null;
  private lastDelivered = 0;
  private lastQueued = 0;
  private estimate: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Reports bytes the socket has finished with, and what is still waiting behind them. */
  note(delivered: number, queued: number): void {
    this.delivered += delivered;
    const at = this.now();
    if (this.lastSampleAt === null) {
      this.reset(at, queued);
      return;
    }
    const elapsed = at - this.lastSampleAt;
    if (elapsed < SAMPLE_INTERVAL_MS) return;
    const backlogged = this.lastQueued > 0 || queued > 0;
    const drained = this.delivered - this.lastDelivered;
    this.reset(at, queued);
    if (!backlogged || drained <= 0) return;
    const rate = (drained * 1000) / elapsed;
    this.estimate = this.estimate === null ? rate : this.estimate * (1 - ALPHA) + rate * ALPHA;
  }

  private reset(at: number, queued: number): void {
    this.lastSampleAt = at;
    this.lastDelivered = this.delivered;
    this.lastQueued = queued;
  }

  /** Bytes per second, or null while the stream has never had to wait for the socket. */
  get bytesPerSecond(): number | null {
    return this.estimate;
  }

  /** The backlog that means MAX_VIEWER_LAG_MS of lag at the measured rate. */
  highWaterBytes(): number {
    if (this.estimate === null) return MAX_HIGH_WATER_BYTES;
    const allowance = (this.estimate * MAX_VIEWER_LAG_MS) / 1000;
    return Math.min(MAX_HIGH_WATER_BYTES, Math.max(MIN_HIGH_WATER_BYTES, Math.round(allowance)));
  }
}
