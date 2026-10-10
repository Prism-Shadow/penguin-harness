/**
 * What the Machines page derives from the server's answer: which machines are in use, the
 * one reading each card gives, and which machines the update notice counts.
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
import { S } from "../../lib/strings";
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
  /**
   * A connection is held, but the last probe found no server running over there. Not a
   * contradiction and not a corner case: the connection is an ssh process on THIS side and
   * outlives the far server, so it says the tunnel has somewhere to go, never that anything
   * answers. Its own reading because it needs its own action — `use` starts the server.
   */
  | { kind: "linkedStopped" }
  /** Installed, and that is as far as this server can take it (a Windows machine). */
  | { kind: "installedOnly" }
  /** Carrying a different build from the one this server would install. */
  | { kind: "behind"; version: string }
  /** Its server answers but nothing holds a connection to it. */
  | { kind: "notConnected" }
  | { kind: "unreachable"; detail: string | null }
  | { kind: "stopped" }
  /**
   * Added to this Project and nothing installed there yet: enabling it is the one thing to do.
   * Also a machine whose last install was undone by hand, until an install corrects the record.
   */
  | { kind: "notInstalled" }
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

const isPhase = (step: string): step is MachinePhase =>
  (MACHINE_PHASES as readonly string[]).includes(step);

/**
 * A step as the interface names it: one of the pipeline's six by its name in the reader's
 * language, any other step the server names (a sub-step) as the server named it.
 */
export function stepLabel(step: string): string {
  return isPhase(step) ? S.machines.step[step] : step;
}

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
    // A held connection is not liveness — the lesson of #561, read the other way round. It
    // used to win outright here, so a machine whose server had stopped still read "Connected"
    // while its own details said otherwise, and `use` (the thing that would start it again)
    // was withheld because the row looked ready. What the last probe found now has the say.
    const status = machine.status;
    if (status !== null && status.state === "stopped") return { kind: "linkedStopped" };
    if (status !== null && status.state === "unreachable") {
      return { kind: "unreachable", detail: status.detail ?? null };
    }
    return {
      kind: "ready",
      port: status?.state === "running" ? (status.port ?? null) : null,
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
  // On this Project's list, nothing installed by it: a machine added without enabling it.
  if (!machine.local && machine.installed === null) return { kind: "notInstalled" };
  if (outOfDate(machine, imageVersion)) {
    return { kind: "behind", version: machine.installed!.version };
  }
  const status = machine.status;
  if (status === null) return { kind: "unknown" };
  if (status.state === "unreachable") return { kind: "unreachable", detail: status.detail ?? null };
  if (status.state === "stopped") return { kind: "stopped" };
  return { kind: "notConnected" };
}

/**
 * The tone a reading's mark carries — by what it means, as tone.ts asks; a held connection is
 * `link`, never `success`. Only a failed job is `danger`: a machine out of reach is waiting on
 * someone (its network, its host), which is `attention`, and red stays for what failed.
 */
export function readingTone(reading: MachineReading): Tone {
  switch (reading.kind) {
    case "queued":
    case "working":
      return "busy";
    case "failed":
      return "danger";
    case "ready":
      // A held connection is a live link, not a verdict: blue, never green.
      return "link";
    case "linkedStopped":
      // The link is up and nothing is serving: something for a person to do, not a failure.
      return "attention";
    case "installedOnly":
      // As far as this server can take it (a Windows machine): nothing waits on anyone, so the
      // mark recedes rather than asking for attention.
      return "muted";
    case "unknown":
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
 * The machines in use here: this Project's list — machines installed for it, and machines added
 * to it that nothing is installed on yet (one an enable is working on included) — by name.
 * By name and nothing else, because the order must not move under a person's eyes: an
 * update rewrites the install time, a probe rewrites the status, and a card that jumps to
 * the top on either is a card someone was about to click. Names compare naturally, so
 * `gpu-2` sits before `gpu-10`. The local entry is kept out: it is where you are, not
 * something you did.
 */
export function machinesInUse(state: MachinesResponse): MachineInfo[] {
  return state.machines
    .filter((machine) => !machine.local && (machine.member === true || machine.installed != null))
    .sort((a, b) =>
      a.alias.localeCompare(b.alias, undefined, { numeric: true, sensitivity: "base" }),
    );
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
  return machinesInUse(state).filter((machine) => outOfDate(machine, state.imageVersion));
}

/**
 * The notice under the title while machines in use carry another build than this server's: which
 * machines, and the keys that waving it away records — each machine at this server's build.
 *
 * Waved away, the notice stays down while every machine behind was already behind at that build,
 * and comes back when another machine falls behind or this server moves to a newer build. The
 * keys live as long as the page does: nothing is stored.
 */
export function updateNotice(
  state: MachinesResponse,
  dismissed: ReadonlySet<string>,
): { ids: string[]; keys: string[] } | null {
  const behind = behindMachines(state);
  if (behind.length === 0) return null;
  const keys = behind.map((machine) => `${machine.id} ${state.imageVersion}`);
  if (keys.every((key) => dismissed.has(key))) return null;
  return { ids: behind.map((machine) => machine.id), keys };
}

/** Whether any job is still to come, which is when the page keeps polling. */
export function anyJobPending(state: MachinesResponse): boolean {
  return state.jobs.some((job) => job.queued || job.running);
}

/**
 * What the page says about this server's install image, if anything. `noImage` is the one
 * case that stops the page: nothing to install and nothing to build it from, so adding and
 * enabling machines are off. A source checkout builds its image when an install asks, so no
 * image yet is no reason to stop — only a build that failed is worth a word, and the word is
 * the build's own.
 */
export type ImageNotice = { kind: "noImage" } | { kind: "buildFailed"; detail: string };

export function imageNotice(state: MachinesResponse): ImageNotice | null {
  const checkout = state.checkoutImage;
  if (checkout?.state === "failed") return { kind: "buildFailed", detail: checkout.detail };
  if (state.imageVersion === null && checkout === undefined) return { kind: "noImage" };
  return null;
}
