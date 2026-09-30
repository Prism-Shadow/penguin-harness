/**
 * Telemetry's boot and hot-update timings (PRFC-0008): the phases of one App generation's
 * create(), measured before the Telemetry node exists and handed to it once the tree is up —
 * which keeps them only while its switch is on — plus what the predecessor measured of its own
 * park and dispose, and the generation's identity. A handful of clock reads per boot, whatever
 * the switch says; the platform's boot code makes one-line calls into this and nothing else.
 *
 * The generation count lives in the runtime's registry so it outlives the swap: how many
 * creates this process has run (the number every sample carries) and, per platform bundle, how
 * many times that bundle was created — the same build pushed twice shows as a repeat.
 */
import { createHash } from "node:crypto";
import { HMR_UPGRADE_PATH } from "@prismshadow/penguin-hmr";
import type { TelemetrySampleInput } from "../api/types.js";
import type { Telemetry } from "../mechanisms/telemetry.js";
import { TELEMETRY_GENERATION_RESOURCE_ID, TELEMETRY_HANDOVER_RESOURCE_ID } from "./service.js";
import type { GenerationRecord, TelemetryHandover } from "./service.js";

/**
 * This platform bundle's identity: a short hash of the address it was imported from, the
 * cache-busting query dropped. A push lands in a content-addressed store, so the same build
 * pushed twice is the same address imported again.
 */
const BUNDLE_ID = createHash("sha256")
  .update(import.meta.url.split("?")[0]!)
  .digest("hex")
  .slice(0, 12);

interface Registry {
  claim<T>(id: string): T | undefined;
  register(id: string, value: unknown): void;
}

export class BootTimings {
  readonly generation: number;
  readonly #createdAt = performance.now();
  readonly #samples: TelemetrySampleInput[] = [];
  readonly #previous: GenerationRecord | undefined;
  readonly #handover: TelemetryHandover | undefined;
  readonly #creates: number;
  readonly #cause: "boot" | "push" | "reassemble";
  /** What this App measures of its own going, left for its successor. */
  readonly #going: TelemetryHandover;

  constructor(
    private readonly resources: Registry,
    reassembling: boolean,
  ) {
    this.#previous = resources.claim<GenerationRecord>(TELEMETRY_GENERATION_RESOURCE_ID);
    this.generation = (this.#previous?.n ?? 0) + 1;
    this.#creates = (this.#previous?.bundles?.[BUNDLE_ID] ?? 0) + 1;
    this.#cause = reassembling ? "reassemble" : this.#previous === undefined ? "boot" : "push";
    resources.register(TELEMETRY_GENERATION_RESOURCE_ID, {
      n: this.generation,
      bundles: { ...this.#previous?.bundles, [BUNDLE_ID]: this.#creates },
    } satisfies GenerationRecord);
    this.#handover = resources.claim<TelemetryHandover>(TELEMETRY_HANDOVER_RESOURCE_ID);
    this.#going = { generation: this.generation };
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
  since(probe: string, start: number): void {
    this.add({ probe, durMs: performance.now() - start });
  }

  add(sample: TelemetrySampleInput): void {
    this.#samples.push(sample);
  }

  /** This App's park took since `start`; recorded by its successor. */
  parked(start: number): void {
    this.#going.parkMs = performance.now() - start;
  }

  /** This App's dispose took since `start`; handed to its successor through the registry. */
  disposed(start: number): void {
    this.#going.disposeMs = performance.now() - start;
    this.resources.register(TELEMETRY_HANDOVER_RESOURCE_ID, this.#going);
  }

  /**
   * Hands everything to the generation's Telemetry: the kept samples, the whole create() as
   * `boot.create`, the predecessor's park and dispose (only when it is the generation this one
   * follows — a create that failed leaves no dispose behind), the generation, and memory.
   */
  flush(telemetry: Telemetry | null): void {
    if (telemetry?.on() !== true) return;
    for (const sample of this.#samples) telemetry.record(sample);
    telemetry.record({ probe: "boot.create", durMs: performance.now() - this.#createdAt });
    const handover = this.#handover;
    if (handover !== undefined && handover.generation === this.#previous?.n) {
      const keys = { generation: handover.generation };
      if (handover.parkMs !== undefined)
        telemetry.record({ probe: "hmr.park", durMs: handover.parkMs, keys });
      if (handover.disposeMs !== undefined) {
        telemetry.record({ probe: "hmr.dispose", durMs: handover.disposeMs, keys });
      }
    }
    telemetry.record({
      probe: "hmr.generation",
      n: this.generation,
      attrs: {
        cause: this.#cause,
        bundle: BUNDLE_ID,
        creates: this.#creates,
        repeat: this.#creates > 1,
      },
    });
    const memory = process.memoryUsage();
    telemetry.record({
      probe: "process.memory",
      bytes: memory.rss,
      attrs: { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
    });
  }
}

/**
 * Telemetry's hmr.admit: a push's admission probe — the runtime's credential-less POST to the
 * upgrade route — is the first request a new generation is sent, before it is swapped in. Only
 * that first request is looked at; every later one goes straight to `served`.
 */
export function timeAdmission(
  served: (request: Request) => Promise<Response | null>,
  telemetry: Telemetry | null,
): (request: Request) => Promise<Response | null> {
  let first = true;
  return (request) => {
    const admission =
      first &&
      request.method === "POST" &&
      new URL(request.url).pathname === HMR_UPGRADE_PATH &&
      !request.headers.has("authorization") &&
      !request.headers.has("cookie");
    first = false;
    if (!admission || telemetry === null) return served(request);
    return telemetry.span(
      "hmr.admit",
      {},
      () => served(request),
      (r) => ({ attrs: { code: r?.status ?? 0 } }),
    );
  };
}
