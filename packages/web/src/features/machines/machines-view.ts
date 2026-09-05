/**
 * What the Machines page derives from the server's answer: which machines are in use, the
 * one sentence each row says, and what the batch selects by default.
 *
 * A row's reading follows a fixed precedence. The server's job for that machine is the
 * freshest word (queued, working, failed); a held connection settles "ready" whatever an
 * older job said, so a machine a re-hold brought back after a failed job reads as ready
 * rather than failed; only then does the last probe speak. Every reading a person can act
 * on is fixed by the same verb — use the machine — so the page never has to explain which
 * of install, update, start, connect a row needs.
 */
import type {
  MachineInfo,
  MachineJob,
  MachinePhase,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import type { Tone } from "../../lib/tone";

export type MachineReading =
  /** Waiting its turn behind another machine's job. */
  | { kind: "queued" }
  /** The server is working on it; `step` is its latest line. */
  | { kind: "working"; step: string | null }
  /** The last job failed, in the far side's own words; `canReplaceProgram` offers the forced install. */
  | { kind: "failed"; step: string; message: string; canReplaceProgram: boolean }
  /** Connected and answering: agents can run there. */
  | { kind: "ready"; port: number | null }
  /** Installed, and that is as far as this server can take it (a Windows machine). */
  | { kind: "installedOnly" }
  /** Carrying a different build from the one this server would install. */
  | { kind: "behind"; version: string }
  /** Its server answers but nothing holds a connection to it. */
  | { kind: "notConnected" }
  | { kind: "unreachable"; detail: string | null }
  | { kind: "stopped" }
  /** Never probed. */
  | { kind: "unknown" };

/**
 * The pipeline's steps in the order a `use` job runs them — the stepper's segments. Spelled
 * here rather than imported because the server's api entry reaches the web as types only;
 * the type keeps it in step with the server's `MachinePhase`, and `PHASE_COMPLETE` fails
 * the build if a step is missing.
 */
export const MACHINE_PHASES = [
  "check",
  "install",
  "handover",
  "restart",
  "connect",
  "sync",
] as const satisfies readonly MachinePhase[];
const PHASE_COMPLETE: Record<MachinePhase, true> = {
  check: true,
  install: true,
  handover: true,
  restart: true,
  connect: true,
  sync: true,
};
void PHASE_COMPLETE;

/** The job the server has for a machine — queued, running, or its last finished one. */
export function jobFor(jobs: readonly MachineJob[], machineId: string): MachineJob | null {
  return jobs.find((job) => job.machineId === machineId) ?? null;
}

export function readMachine(
  machine: MachineInfo,
  job: MachineJob | null,
  imageVersion: string | null,
): MachineReading {
  if (job?.queued) return { kind: "queued" };
  if (job?.running) return { kind: "working", step: job.log.at(-1) ?? null };
  if (machine.connection !== null) {
    return {
      kind: "ready",
      port: machine.status?.state === "running" ? (machine.status.port ?? null) : null,
    };
  }
  const result = job?.result ?? null;
  if (result !== null && !result.ok) {
    return {
      kind: "failed",
      step: result.step,
      message: result.message,
      canReplaceProgram: result.canReplaceProgram === true,
    };
  }
  if (result !== null && job?.kind === "use" && "installed" in result)
    return { kind: "installedOnly" };
  if (outOfDate(machine, imageVersion)) {
    return { kind: "behind", version: machine.installed!.version };
  }
  const status = machine.status;
  if (status === null) return { kind: "unknown" };
  if (status.state === "unreachable") return { kind: "unreachable", detail: status.detail ?? null };
  if (status.state === "stopped") return { kind: "stopped" };
  return { kind: "notConnected" };
}

/** The tone a reading's mark carries — by what it means, as tone.ts asks; ready is muted, not success, so a fleet at rest reads grey. */
export function readingTone(reading: MachineReading): Tone {
  switch (reading.kind) {
    case "queued":
    case "working":
      return "busy";
    case "failed":
    case "unreachable":
      return "danger";
    case "ready":
    case "unknown":
      // A healthy machine is the quiet one: green would raise a flag where none is needed.
      return "muted";
    default:
      return "attention";
  }
}

/** Whether "use" would change anything for this row — everything but ready, busy, and installed-as-far-as-it-goes. */
export function wantsUse(reading: MachineReading): boolean {
  return !["queued", "working", "ready", "installedOnly"].includes(reading.kind);
}

/**
 * The machines in use here: those this server has installed on for this Project, most
 * recently installed first. Ties keep the config's order, so the list is stable between
 * polls. The local entry is kept out: it is where you are, not something you did.
 */
export function installedMachines(state: MachinesResponse): MachineInfo[] {
  return state.machines
    .map((machine, index) => ({ machine, index }))
    .filter((entry) => entry.machine.installed != null && !entry.machine.local)
    .sort((a, b) => {
      const at = b.machine.installed!.at.localeCompare(a.machine.installed!.at);
      return at !== 0 ? at : a.index - b.index;
    })
    .map((entry) => entry.machine);
}

/** The local entry, which the server always puts first. */
export function localMachine(state: MachinesResponse): MachineInfo | null {
  return state.machines.find((machine) => machine.local) ?? null;
}

/**
 * A machine carrying a different build from the one this server would install: what "use"
 * brings forward. No image, or a fresh machine, is not "behind" — there is nothing to
 * compare against, or nothing to update.
 */
export function outOfDate(machine: MachineInfo, imageVersion: string | null): boolean {
  if (imageVersion === null || machine.local || machine.installed === null) return false;
  return machine.installed.version !== imageVersion;
}

/** The machines in use that carry another build — what "update all" brings forward, in list order. */
export function behindMachines(state: MachinesResponse): MachineInfo[] {
  return installedMachines(state).filter((machine) => outOfDate(machine, state.imageVersion));
}

/**
 * The batch's selection when nobody has touched it: every machine in use. A person opening
 * the page to "make them all work" should find them all already ticked.
 */
export function defaultSelection(state: MachinesResponse): Set<string> {
  return new Set(installedMachines(state).map((machine) => machine.id));
}

/** Whether any job is still to come, which is when the page keeps polling. */
export function anyJobPending(state: MachinesResponse): boolean {
  return state.jobs.some((job) => job.queued || job.running);
}
