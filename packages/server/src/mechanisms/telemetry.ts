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
  /** The buffered samples matching the query, oldest first. */
  samples(query: TelemetryQuery): TelemetrySample[];
  /** Empties the buffer. */
  clear(): void;
}>() {}
