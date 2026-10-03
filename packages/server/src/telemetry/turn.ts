/**
 * One run's server-side segments (PRFC-0008, the per-turn probes): what the session manager's
 * drive loop spends per streamed message outside the model — the live tail, the channel
 * publish (fan-out), the stream error watcher and the usage recorder — summed per run, not
 * recorded per message. A long answer streams thousands of messages; one sample each would
 * fill the ring in a few turns, so a run hands over one sample per segment when it ends.
 *
 * The model's share is measured on the same clock: from each top-level `request_begin` to
 * its `request_end`, as they reach the server. What is left of the run once the model and
 * these segments are taken out is core's own time (tool calls, MCP, trace writes).
 */
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { TelemetrySampleInput } from "../api/types.js";
import type { Telemetry } from "../mechanisms/telemetry.js";

export const TURN_SEGMENTS = ["tail", "fanout", "errors", "usage"] as const;
export type TurnSegment = (typeof TURN_SEGMENTS)[number];

interface SegmentTally {
  count: number;
  totalMs: number;
  maxMs: number;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** What the drive loop holds for one run: a real tally while telemetry is on, else one that only runs the work. */
export interface TurnTimer {
  message(msg: OmniMessage): void;
  time<T>(segment: TurnSegment, run: () => T): T;
  timeAsync<T>(segment: TurnSegment, run: () => Promise<T>): Promise<T>;
  /** Hands the run's samples to telemetry. */
  finish(status: "ok" | "error"): void;
}

const UNTIMED: TurnTimer = {
  message: () => {},
  time: (_segment, run) => run(),
  timeAsync: (_segment, run) => run(),
  finish: () => {},
};

/** The timer for one run, decided at its start: whether the switch is on then holds for the whole run. */
export function turnTimer(telemetry: Telemetry | undefined): TurnTimer {
  if (telemetry?.on() !== true) return UNTIMED;
  const tally = new TurnTally();
  return {
    message: (msg) => tally.message(msg),
    time: (segment, run) => tally.time(segment, run),
    timeAsync: (segment, run) => tally.timeAsync(segment, run),
    finish: (status) => {
      for (const sample of tally.samples(status)) telemetry.record(sample);
    },
  };
}

export class TurnTally {
  readonly #now: () => number;
  readonly #startedAt: number;
  readonly #segments = new Map<TurnSegment, SegmentTally>(
    TURN_SEGMENTS.map((s) => [s, { count: 0, totalMs: 0, maxMs: 0 }]),
  );
  #messages = 0;
  #requests = 0;
  #modelMs = 0;
  /** When the model request in flight began; null between requests. */
  #requestAt: number | null = null;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.#startedAt = now();
  }

  /** Counts one streamed message and, for a top-level request boundary, opens or closes the model window. */
  message(msg: OmniMessage): void {
    this.#messages += 1;
    if (msg.origin !== undefined && msg.origin.length > 0) return;
    const type = (msg.payload as { type?: string }).type;
    if (type === "request_begin") {
      this.#requests += 1;
      this.#requestAt = this.#now();
    } else if (type === "request_end" && this.#requestAt !== null) {
      this.#modelMs += this.#now() - this.#requestAt;
      this.#requestAt = null;
    }
  }

  /** Runs one segment's work for the current message and adds its time. */
  time<T>(segment: TurnSegment, run: () => T): T {
    const start = this.#now();
    try {
      return run();
    } finally {
      this.#add(segment, this.#now() - start);
    }
  }

  /** As `time`, for work the loop awaits (the usage recorder). */
  async timeAsync<T>(segment: TurnSegment, run: () => Promise<T>): Promise<T> {
    const start = this.#now();
    try {
      return await run();
    } finally {
      this.#add(segment, this.#now() - start);
    }
  }

  #add(segment: TurnSegment, ms: number): void {
    const s = this.#segments.get(segment)!;
    s.count += 1;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  /**
   * The run's samples: `turn.run` (the whole drive, with the model's share) and one
   * `turn.<segment>` per segment. A request still open when the stream ended (an abort) counts
   * up to now. The caller's scope supplies the session, task and request keys.
   */
  samples(status: "ok" | "error"): TelemetrySampleInput[] {
    const end = this.#now();
    const modelMs = this.#modelMs + (this.#requestAt !== null ? end - this.#requestAt : 0);
    const segmentMs = [...this.#segments.values()].reduce((sum, s) => sum + s.totalMs, 0);
    return [
      {
        probe: "turn.run",
        durMs: end - this.#startedAt,
        n: this.#messages,
        status,
        attrs: { modelMs: round(modelMs), requests: this.#requests, serverMs: round(segmentMs) },
      },
      ...[...this.#segments].map(([segment, s]) => ({
        probe: `turn.${segment}`,
        durMs: s.totalMs,
        n: s.count,
        attrs: { maxMs: round(s.maxMs) },
      })),
    ];
  }
}
