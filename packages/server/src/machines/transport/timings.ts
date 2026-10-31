/**
 * Where the machine connection's timings go (PRFC-0008): a sink, or nothing.
 *
 * Every collection point on the way to a machine — each command on its session, each stage of
 * a connect — asks `timingsSink()` first and
 * does nothing else when it answers null. That is the whole cost while telemetry is off: one
 * read of a slot and one comparison per point, no clock read, no allocation, no timer.
 *
 * The slot is PROCESS-wide (a `Symbol.for` key on globalThis), not a module variable, because
 * a held ssh session outlives the platform generation that opened it: it is delivered across a
 * hot push and keeps running the code of the build that created it (ssh-session.ts). A module
 * variable would leave that session reporting to a generation that is gone; a slot read at
 * each call reports to whichever generation set it last.
 *
 * Samples carry shape only — durations, counts, exit codes, stage names — and the machine's
 * address as the correlation key. Never a command's text, its output, or a path.
 */

/** One fact from a collection point: PRFC-0008's `Sample`, as far as machines use it. */
export interface MachineSample {
  /** When it was recorded, epoch ms. */
  ts: number;
  /** The collection point, named for its layer: `machine.ssh.command`, `machine.connect.stage`, … */
  probe: string;
  durMs?: number;
  /** `ok`, `error`, or the point's own word (`timeout`, `exit`). */
  status?: string;
  keys: { machine: string };
  attrs?: Record<string, string | number | boolean>;
}

/** Takes a sample. Must not throw into the caller; a sink that does is caught. */
export type TimingsSink = (sample: MachineSample) => void;

const SLOT = Symbol.for("penguin.machines.timingsSink");
type Slotted = { [SLOT]?: TimingsSink | null };

/** The sink while telemetry is on; null while it is off. */
export function timingsSink(): TimingsSink | null {
  return (globalThis as Slotted)[SLOT] ?? null;
}

/**
 * Switches the machine collection points on (a sink) or off (null). Whoever owns the switch
 * calls it — at boot and whenever the setting changes.
 */
export function setTimingsSink(sink: TimingsSink | null): void {
  (globalThis as Slotted)[SLOT] = sink;
}

/** Hands a sample to the sink, if there is one; a failing sink never fails the connection. */
export function emit(sample: MachineSample): void {
  const sink = timingsSink();
  if (sink === null) return;
  try {
    sink(sample);
  } catch {
    // Telemetry is an instrument, not a dependency: its failure is not the machine's.
  }
}

/** Milliseconds to a tenth: a sample is read by a person, and sub-ms digits are noise. */
export function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** A command's answer when the machine said nothing before its timeout. */
export const NO_ANSWER = "the machine did not answer in time";

/**
 * One command on a machine's session, as a `machine.ssh.command` sample: from the ask to the
 * answer (its wait behind the session's other commands included) and its exit code — never its
 * text, which names paths. While telemetry is off, just runs it.
 */
export function timedCommand<R extends { code: number; output: string }>(
  machine: string,
  run: () => Promise<R>,
): Promise<R> {
  if (timingsSink() === null) return run();
  const start = performance.now();
  return run().then((result) => {
    emit({
      ts: Date.now(),
      probe: "machine.ssh.command",
      durMs: round(performance.now() - start),
      status:
        result.code === 0
          ? "ok"
          : result.code === 255 && result.output === NO_ANSWER
            ? "timeout"
            : "exit",
      keys: { machine },
      attrs: { code: result.code },
    });
    return result;
  });
}
