/**
 * A connect, stage by stage: when each began and ended, and whether it went through.
 *
 * Two readers. The JOB keeps the stages it ran (`MachineJob.stages`) — a handful of timestamps
 * beside its log, as long-lived as the job row, always — so the Machines page and anyone
 * polling it can tell which step a slow connect spent its time in. And while telemetry is on
 * (transport/timings.ts), every stage is also a `machine.connect.stage` sample and the whole
 * connect a `machine.connect` one, which is how a re-hold nobody watches is measured too.
 *
 * A re-hold has no job; with telemetry off it keeps nothing and reads no clock.
 */
import type { MachineConnectStage, MachineJob, MachineStageTiming } from "../api/types.js";
import { emit, round, timingsSink } from "./transport/index.js";

export class ConnectClock {
  /** Where the stages are kept — the job's own list — or null when nobody keeps them. */
  readonly #kept: MachineStageTiming[] | null;
  /** performance.now() at the start, while telemetry is on. */
  readonly #t0: number | null;

  constructor(
    private readonly address: string,
    private readonly now: () => Date,
    kept: MachineStageTiming[] | null,
  ) {
    this.#kept = kept;
    this.#t0 = timingsSink() === null ? null : performance.now();
  }

  /** Runs one stage and records it; `ok` reads the stage's own answer (a thrown error is not ok). */
  async stage<T>(
    stage: MachineConnectStage,
    work: () => Promise<T>,
    ok: (value: T) => boolean = () => true,
  ): Promise<T> {
    const sampling = timingsSink() !== null;
    if (this.#kept === null && !sampling) return work();
    const startedAt = this.now().toISOString();
    const t0 = sampling ? performance.now() : 0;
    let passed = false;
    try {
      const value = await work();
      passed = ok(value);
      return value;
    } finally {
      this.#kept?.push({ stage, startedAt, endedAt: this.now().toISOString(), ok: passed });
      if (sampling) {
        emit({
          ts: Date.now(),
          probe: "machine.connect.stage",
          durMs: round(performance.now() - t0),
          status: passed ? "ok" : "error",
          keys: { machine: this.address },
          attrs: { stage },
        });
      }
    }
  }

  /** The connect's end, as one `machine.connect` sample: its whole span and how it ended. */
  done(result: MachineJob["result"]): void {
    if (this.#t0 === null) return;
    emit({
      ts: Date.now(),
      probe: "machine.connect",
      durMs: round(performance.now() - this.#t0),
      status: result?.ok === true ? "ok" : "error",
      keys: { machine: this.address },
      ...(result !== null && !result.ok ? { attrs: { failedStep: result.step } } : {}),
    });
  }
}
