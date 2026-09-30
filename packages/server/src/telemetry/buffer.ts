/**
 * The telemetry sample buffer (PRFC-0008 "存储与上限"): in process, bounded by count AND by
 * bytes, oldest evicted first — the SSE channel's ring (runtime/channel.ts) is its model.
 * Nothing here touches disk; the buffer lives exactly as long as the App generation holding it.
 */
import type {
  TelemetryProbeSummary,
  TelemetryQuery,
  TelemetrySample,
  TelemetrySessionSummary,
} from "../api/types.js";

/** Default caps; PRFC-0008 lists both as provisional until real deployments have run with them. */
export const DEFAULT_MAX_SAMPLES = 50_000;
export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

/** A sample's weight against the byte cap: its JSON length (UTF-16 units, as the channel counts). */
function weigh(sample: TelemetrySample): number {
  return JSON.stringify(sample).length;
}

export class SampleRing {
  #items: TelemetrySample[] = [];
  #weights: number[] = [];
  /** Index of the oldest live item; the arrays are compacted once the dead prefix grows. */
  #head = 0;
  #bytes = 0;

  constructor(
    private readonly maxSamples = DEFAULT_MAX_SAMPLES,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
  ) {}

  get size(): number {
    return this.#items.length - this.#head;
  }

  get bytes(): number {
    return this.#bytes;
  }

  push(sample: TelemetrySample): void {
    const weight = weigh(sample);
    this.#items.push(sample);
    this.#weights.push(weight);
    this.#bytes += weight;
    while (this.size > this.maxSamples || (this.#bytes > this.maxBytes && this.size > 1)) {
      this.#bytes -= this.#weights[this.#head]!;
      this.#head += 1;
    }
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#weights = this.#weights.slice(this.#head);
      this.#head = 0;
    }
  }

  /** Live samples, oldest first. */
  list(): TelemetrySample[] {
    return this.#items.slice(this.#head);
  }

  clear(): void {
    this.#items = [];
    this.#weights = [];
    this.#head = 0;
    this.#bytes = 0;
  }
}

/** The samples a query selects, oldest first; `limit` keeps the newest. */
export function selectSamples(all: TelemetrySample[], q: TelemetryQuery): TelemetrySample[] {
  const matched = all.filter(
    (s) =>
      (q.probe === undefined || s.probe === q.probe) &&
      (q.session === undefined || s.keys.session === q.session),
  );
  return q.limit !== undefined && matched.length > q.limit
    ? matched.slice(matched.length - q.limit)
    : matched;
}

/** Nearest-rank percentile over an ascending list. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** Per-probe count, p50, p95, max and bytes, in the order the probes first appear. */
export function summarizeProbes(samples: TelemetrySample[]): TelemetryProbeSummary[] {
  const byProbe = new Map<string, TelemetrySample[]>();
  for (const s of samples) {
    const list = byProbe.get(s.probe);
    if (list === undefined) byProbe.set(s.probe, [s]);
    else list.push(s);
  }
  return [...byProbe].map(([probe, list]) => {
    const durations = list
      .map((s) => s.durMs)
      .filter((d): d is number => d !== undefined)
      .sort((a, b) => a - b);
    const sized = list.filter((s) => s.bytes !== undefined);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    return {
      probe,
      count: list.length,
      p50Ms: p50 === null ? null : round(p50),
      p95Ms: p95 === null ? null : round(p95),
      maxMs: durations.length === 0 ? null : round(durations[durations.length - 1]!),
      bytes: sized.length === 0 ? null : sized.reduce((sum, s) => sum + s.bytes!, 0),
    };
  });
}

/** Per-session figures for the samples that carry a session key, most recently active first. */
export function summarizeSessions(samples: TelemetrySample[]): TelemetrySessionSummary[] {
  const bySession = new Map<string, TelemetrySample[]>();
  for (const s of samples) {
    const session = s.keys.session;
    if (session === undefined) continue;
    const list = bySession.get(session);
    if (list === undefined) bySession.set(session, [s]);
    else list.push(s);
  }
  return [...bySession]
    .map(([session, list]) => {
      const probes = new Map<string, { count: number; totalMs: number; maxMs: number | null }>();
      for (const s of list) {
        const p = probes.get(s.probe) ?? { count: 0, totalMs: 0, maxMs: null };
        p.count += 1;
        if (s.durMs !== undefined) {
          p.totalMs += s.durMs;
          p.maxMs = p.maxMs === null ? s.durMs : Math.max(p.maxMs, s.durMs);
        }
        probes.set(s.probe, p);
      }
      return {
        session,
        count: list.length,
        lastTs: list[list.length - 1]!.ts,
        probes: [...probes].map(([probe, p]) => ({
          probe,
          count: p.count,
          totalMs: round(p.totalMs),
          maxMs: p.maxMs === null ? null : round(p.maxMs),
        })),
      };
    })
    .sort((a, b) => b.lastTs - a.lastTs);
}
