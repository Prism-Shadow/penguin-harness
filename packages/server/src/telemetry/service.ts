/**
 * Telemetry (PRFC-0008): the master switch, the sample buffer and the per-request scope.
 *
 * The switch is read from the server settings ONCE, when this node is created, and written
 * through `setEnabled` afterwards — so a probe's `on()` is a field read, never a SQLite query,
 * and a change applies to the very next request. While off there is no buffer at all; turning
 * it off drops the one there was. The buffer belongs to this App generation: a hot push boots
 * a new node with an empty one.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  TelemetryKeys,
  TelemetryQuery,
  TelemetrySample,
  TelemetrySampleInput,
} from "../api/types.js";
import type { Settings } from "../mechanisms/settings.js";
import type { Telemetry } from "../mechanisms/telemetry.js";
import { SampleRing, selectSamples } from "./buffer.js";

/** The server_settings key of the master switch (JSON boolean; absent = off). */
export const TELEMETRY_ENABLED_KEY = "telemetry.enabled";

/**
 * The App generation count, in the runtime's resource registry so it outlives a swap: the
 * platform's create() bumps it (hmr/platform.ts), and every sample a generation records
 * carries its number — the "代号" that tells one boot's samples from the next one's.
 */
export const TELEMETRY_GENERATION_RESOURCE_ID = "platform.telemetryGeneration";

/**
 * The registry entry behind TELEMETRY_GENERATION_RESOURCE_ID: how many App generations this
 * process has created.
 */
export interface GenerationRecord {
  n: number;
}

/**
 * What the outgoing App measured of its own going — its park() and its dispose effect — left
 * in the registry for the next generation to record (the outgoing buffer is dropped with it).
 */
export const TELEMETRY_HANDOVER_RESOURCE_ID = "platform.telemetryHandover";

export interface TelemetryHandover {
  generation: number;
  parkMs?: number;
  disposeMs?: number;
}

@Component()
export class TelemetryService implements Telemetry {
  @Use() private readonly settings!: Settings;
  #ring: SampleRing | null = null;
  readonly #scope = new AsyncLocalStorage<TelemetryKeys>();
  #generation: number | undefined;
  readonly #snapshots: Array<() => void> = [];

  setup({ resources }: ClassCtx) {
    const record = resources.claim<GenerationRecord>(TELEMETRY_GENERATION_RESOURCE_ID);
    this.#generation = record?.n;
    if (this.settings.get(TELEMETRY_ENABLED_KEY) === "true") this.#ring = new SampleRing();
  }

  on(): boolean {
    return this.#ring !== null;
  }

  setEnabled(enabled: boolean): void {
    this.settings.set(TELEMETRY_ENABLED_KEY, JSON.stringify(enabled));
    if (!enabled) this.#ring = null;
    else this.#ring ??= new SampleRing();
  }

  record(input: TelemetrySampleInput): TelemetrySample | null {
    const ring = this.#ring;
    if (ring === null) return null;
    const scoped = this.#scope.getStore();
    const sample: TelemetrySample = {
      ts: Date.now(),
      probe: input.probe,
      ...(input.durMs !== undefined ? { durMs: Math.round(input.durMs * 10) / 10 } : {}),
      ...(input.bytes !== undefined ? { bytes: input.bytes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      keys: {
        ...(this.#generation !== undefined ? { generation: this.#generation } : {}),
        ...scoped,
        ...input.keys,
      },
      ...(input.attrs !== undefined ? { attrs: input.attrs } : {}),
    };
    ring.push(sample);
    return sample;
  }

  within(keys: TelemetryKeys, run: () => Promise<unknown>): Promise<unknown> {
    if (this.#ring === null) return run();
    return this.#scope.run({ ...this.#scope.getStore(), ...keys }, run);
  }

  async span<T>(
    probe: string,
    keys: TelemetryKeys,
    run: () => Promise<T>,
    describe?: (result: T) => Pick<TelemetrySampleInput, "bytes" | "attrs">,
  ): Promise<T> {
    if (this.#ring === null) return run();
    const start = performance.now();
    let result: T;
    try {
      result = await this.#scope.run({ ...this.#scope.getStore(), ...keys }, run);
    } catch (err) {
      this.record({ probe, durMs: performance.now() - start, status: "error", keys });
      throw err;
    }
    this.record({
      probe,
      durMs: performance.now() - start,
      status: "ok",
      keys,
      ...describe?.(result),
    });
    return result;
  }

  time<T>(
    probe: string,
    keys: TelemetryKeys,
    run: () => T,
    describe?: (result: T) => Pick<TelemetrySampleInput, "bytes" | "attrs">,
  ): T {
    if (this.#ring === null) return run();
    const start = performance.now();
    let result: T;
    try {
      result = this.#scope.run({ ...this.#scope.getStore(), ...keys }, run);
    } catch (err) {
      this.record({ probe, durMs: performance.now() - start, status: "error", keys });
      throw err;
    }
    this.record({
      probe,
      durMs: performance.now() - start,
      status: "ok",
      keys,
      ...describe?.(result),
    });
    return result;
  }

  samples(query: TelemetryQuery): TelemetrySample[] {
    return this.#ring === null ? [] : selectSamples(this.#ring.list(), query);
  }

  clear(): void {
    this.#ring?.clear();
  }

  addSnapshot(take: () => void): void {
    this.#snapshots.push(take);
  }

  snapshot(): void {
    if (this.#ring === null) return;
    this.record({ probe: "process.memory", attrs: { memoryCost: process.memoryUsage().rss } });
    for (const take of this.#snapshots) take();
  }
}
