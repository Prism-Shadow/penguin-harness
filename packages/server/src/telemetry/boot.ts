/**
 * Telemetry's boot timings (PRFC-0008): the phases of one App generation's create(), measured
 * before the Telemetry node exists and handed to it once the tree is up, which keeps them only
 * while its switch is on. A handful of clock reads per boot, whatever the switch says.
 *
 * It also numbers the generations: how many creates this process has run, counted in the
 * runtime's registry so the count outlives the swap — the number every sample carries.
 */
import type { TelemetrySampleInput } from "../api/types.js";
import type { Telemetry } from "../mechanisms/telemetry.js";
import { TELEMETRY_GENERATION_RESOURCE_ID } from "./service.js";

interface Registry {
  claim<T>(id: string): T | undefined;
  register(id: string, value: unknown): void;
}

export class BootTimings {
  readonly generation: number;
  readonly #createdAt = performance.now();
  readonly #samples: TelemetrySampleInput[] = [];

  constructor(resources: Registry) {
    this.generation =
      (resources.claim<{ n: number }>(TELEMETRY_GENERATION_RESOURCE_ID)?.n ?? 0) + 1;
    resources.register(TELEMETRY_GENERATION_RESOURCE_ID, { n: this.generation });
  }

  /** Runs `run`, keeping its time as one `probe` sample. */
  time<T>(probe: string, run: () => T): T {
    const start = performance.now();
    try {
      return run();
    } finally {
      this.add({ probe, durMs: performance.now() - start });
    }
  }

  /** Keeps the time since `start` (a `performance.now()`) as one `probe` sample. */
  since(probe: string, start: number, attrs?: TelemetrySampleInput["attrs"]): void {
    this.add({ probe, durMs: performance.now() - start, ...(attrs ? { attrs } : {}) });
  }

  add(sample: TelemetrySampleInput): void {
    this.#samples.push(sample);
  }

  /** Hands the kept samples, and the whole create() as `boot.create`, to the generation's Telemetry. */
  flush(telemetry: Telemetry | null): void {
    if (telemetry?.on() !== true) return;
    for (const sample of this.#samples) telemetry.record(sample);
    telemetry.record({ probe: "boot.create", durMs: performance.now() - this.#createdAt });
  }
}
