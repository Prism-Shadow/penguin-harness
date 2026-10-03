/**
 * The telemetry mechanism (PRFC-0008): what a node may require, declared apart from what
 * implements it (telemetry/service.ts).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type {
  TelemetryKeys,
  TelemetryQuery,
  TelemetrySample,
  TelemetrySampleInput,
} from "../api/types.js";

/**
 * Telemetry: the switch, the in-memory sample buffer and the scope that carries a request's
 * keys to the samples it causes. Off by default; while off, `on()` is the one check a probe
 * pays and nothing is allocated.
 */
export abstract class Telemetry extends Interface<{
  /** Whether the fixed probes record — one boolean held in memory, never a settings read. */
  on(): boolean;
  /** Stores the switch in the server settings and applies it at once (off drops the buffer). */
  setEnabled(enabled: boolean): void;
  /**
   * Records one sample (a no-op while off) and returns the stored copy, or null. The keys of
   * the enclosing scope (see within) are merged under the sample's own. The caller may still
   * add to the returned sample's `bytes` — a streamed response is counted as it is written.
   */
  record(sample: TelemetrySampleInput): TelemetrySample | null;
  /** Runs `run` with `keys` added to the scope every sample recorded inside it inherits; while off, just runs it. */
  within(keys: TelemetryKeys, run: () => Promise<unknown>): Promise<unknown>;
  /**
   * Times `run` as one `probe` sample — `ok`, or `error` when it throws — with `keys` in the
   * scope of every sample recorded inside it, and `describe` adding what the result says (a
   * count, a size, attributes). While off, just runs it: this is the one call a measured
   * module makes, so the module itself holds no clock, no scope and no sample.
   */
  span<T>(
    probe: string,
    keys: TelemetryKeys,
    run: () => Promise<T>,
    describe?: (result: T) => Pick<TelemetrySampleInput, "bytes" | "attrs">,
  ): Promise<T>;
  /** `span` for synchronous work. */
  time<T>(
    probe: string,
    keys: TelemetryKeys,
    run: () => T,
    describe?: (result: T) => Pick<TelemetrySampleInput, "bytes" | "attrs">,
  ): T;
  /** The buffered samples matching the query, oldest first. */
  samples(query: TelemetryQuery): TelemetrySample[];
  /** Empties the buffer. */
  clear(): void;
  /**
   * Registers something that records the current state as samples (the Sessions record one
   * `session.memory` each). Taken only when the buffer is read, never on a schedule.
   */
  addSnapshot(take: () => void): void;
  /**
   * Records the current state into the buffer: `process.memory`, then every registered
   * snapshot. The read route calls it before answering; while off it does nothing.
   */
  snapshot(): void;
}>() {}
