/**
 * What the Machines page derives from the server's answer: which machines are in use, the
 * one reading each card gives, and which machines the update notice counts.
 *
 * A row's reading follows a fixed precedence. The server's job for that machine is the
 * freshest word (queued, working); then the server bringing back a machine it keeps connected
 * (reconnecting), or having stopped trying (reconnectFailed, reconnectStopped, signInRefused); then
 * a held connection, which settles "ready" whatever an older job said, so a
 * machine brought back after a failed job reads as ready rather than failed; only then does the
 * last job's failure, and after it the last probe, speak.
 */
import type {
  MachineInfo,
  MachineJob,
  MachinePhase,
  MachineSshFailure,
  MachineSocketFact,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import type { RetryPhase } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

export type MachineReading =
  /** Waiting its turn behind another machine's job. */
  | { kind: "queued" }
  /** The server is working on it; `step` is its latest line. */
  | { kind: "working"; step: string | null }
  /** The last job failed, in the far side's own words; `canReplaceProgram`: installing again may mend it. */
  | { kind: "failed"; step: string; message: string; canReplaceProgram: boolean }
  /** Connected and answering: agents can run there. */
  | { kind: "ready"; port: number | null }
  /**
   * Kept connected, and being brought back by the server: its connection dropped, its server
   * stopped or restarted, or this server just started. `since` is when the streak began;
   * `attempts` failed so far of the `maxAttempts` that stop it; `nextAt` is when the next one
   * runs, null while one runs. `message` is the last failure as the page says it; null before
   * the first one.
   */
  | {
      kind: "reconnecting";
      since: string;
      attempts: number;
      maxAttempts: number;
      nextAt: string | null;
      message: string | null;
    }
  /**
   * Kept connected, and bringing it back failed: `attempts` — that many failures in a row; `ssh` —
   * a refusal no retry mends. Nothing runs until a Retry. `message` is the last failure as the
   * page says it (an ssh refusal in the reader's language, with its fix).
   */
  | {
      kind: "reconnectFailed";
      why: "attempts" | "ssh";
      since: string;
      attempts: number;
      maxAttempts: number;
      message: string | null;
    }
  /** Kept connected, and a person stopped the server bringing it back; nothing runs until a Retry. */
  | {
      kind: "reconnectStopped";
      since: string;
      attempts: number;
      maxAttempts: number;
      message: string | null;
    }
  /**
   * Kept connected, and its stored password refused — or its host takes none: the server does not
   * try again until the machine's SSH settings change, since retrying could lock the account.
   */
  | { kind: "signInRefused"; reason: "password-rejected" | "password-not-offered" }
  /** Installed, and that is as far as this server can take it (a Windows machine). */
  | { kind: "installedOnly" }
  /** Carrying a different build from the one this server would install. */
  | { kind: "behind"; version: string }
  /**
   * Connected, and its server answers requests but never the API socket (its `socket` reads
   * `unanswered`): a server process older than its build, which keeps every live update from the
   * machine away until it runs this server's version: its dialog's Restart first, and failing
   * that Update or a reinstall.
   */
  | { kind: "restartNeeded" }
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
 * Every step a job may name. A job carries its own steps (`MachineJob.steps`); this is what a
 * step the server names is checked against. Spelled here rather than imported because the
 * server's api entry reaches the web as types only; the type keeps it in step with the
 * server's `MachinePhase`, and `PHASE_COMPLETE` fails the build if a step is missing.
 */
export const MACHINE_PHASES = [
  "build",
  "check",
  "install",
  "handover",
  "restart",
  "connect",
  "sync",
  "stop",
  "remove",
] as const satisfies readonly MachinePhase[];
const PHASE_COMPLETE: Record<MachinePhase, true> = {
  build: true,
  check: true,
  install: true,
  handover: true,
  restart: true,
  connect: true,
  sync: true,
  stop: true,
  remove: true,
};
void PHASE_COMPLETE;

export const isPhase = (step: string): step is MachinePhase =>
  (MACHINE_PHASES as readonly string[]).includes(step);

/**
 * ssh's own lines out of what the server said: after its sentence, `(ssh: …)` — without the
 * `ssh:` its own diagnostics begin with, since the page says "ssh:" before them itself.
 */
export function sshWords(said: string): string {
  const words = /\(ssh: ([\s\S]*)\)\s*$/.exec(said)?.[1];
  return (words ?? said).trim().replace(/^ssh:\s*/, "");
}

/**
 * Why a job failed, as the page says it: an ssh refusal in the reader's language from the
 * reason the server found, with ssh's own words as its detail; anything else in the far side's
 * own words, as the server relayed them.
 */
export function failureText(
  result: { message: string; sshReason?: MachineSshFailure },
  alias: string,
): { message: string; detail: string | null } {
  if (result.sshReason === undefined) return { message: result.message, detail: null };
  const c = S.machines.check;
  return {
    message: c.ssh[result.sshReason](alias),
    detail: c.sshSaid(sshWords(result.message)),
  };
}

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
  // The server keeps an enabled machine connected and says when it is bringing one back — a
  // held ssh session is not liveness (#561), and a server that stopped behind one is exactly
  // what it notices and restarts.
  if (machine.reconnect?.waitsForPassword === true) {
    return {
      kind: "signInRefused",
      reason:
        machine.reconnect.sshReason === "password-not-offered"
          ? "password-not-offered"
          : "password-rejected",
    };
  }
  const reconnect = machine.reconnect;
  const lastFailure =
    reconnect === undefined || reconnect.lastError === null
      ? null
      : failureText(
          {
            message: reconnect.lastError,
            ...(reconnect.sshReason === undefined ? {} : { sshReason: reconnect.sshReason }),
          },
          machine.alias,
        ).message;
  if (reconnect?.gaveUp !== undefined) {
    const streak = {
      since: reconnect.since,
      attempts: reconnect.attempts,
      maxAttempts: reconnect.maxAttempts,
      message: lastFailure,
    };
    return reconnect.gaveUp === "cancelled"
      ? { kind: "reconnectStopped", ...streak }
      : { kind: "reconnectFailed", why: reconnect.gaveUp, ...streak };
  }
  if (reconnect !== undefined) {
    return {
      kind: "reconnecting",
      since: reconnect.since,
      attempts: reconnect.attempts,
      maxAttempts: reconnect.maxAttempts,
      nextAt: reconnect.nextAt,
      message: lastFailure,
    };
  }
  if (machine.connection !== null) {
    // Whatever build it reports: the build on its disk is not the process that serves it.
    if (needsRestart(machine)) return { kind: "restartNeeded" };
    const status = machine.status;
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
      message: failureText(result, machine.alias).message,
      canReplaceProgram: result.canReplaceProgram === true,
    };
  }
  if (result !== null && job?.kind === "use" && "installed" in result)
    return { kind: "installedOnly" };
  // On this Project's list, nothing installed by it: a machine added without enabling it.
  if (!machine.local && machine.installed === null) return { kind: "notInstalled" };
  // A server that is stopped, or out of reach, says so whatever build it carries: the build is
  // the pill's and the version badge's to say, and a person who just stopped a machine reads
  // "Stopped", not "Update available".
  const status = machine.status;
  if (status?.state === "stopped") return { kind: "stopped" };
  if (status?.state === "unreachable") {
    return { kind: "unreachable", detail: status.detail ?? null };
  }
  if (outOfDate(machine, imageVersion)) {
    return { kind: "behind", version: machine.installed!.version };
  }
  if (status === null) return { kind: "unknown" };
  return { kind: "notConnected" };
}

/**
 * The tone a reading's mark carries — by what it means, as tone.ts asks; a held connection is
 * `link`, never `success`. A failed job, a failed reconnect and a refused sign-in are `danger`: a
 * machine out of reach, or one a person stopped bringing back, is waiting on someone (its network,
 * its host, that person's Retry), which is `attention`, and red stays for what failed.
 */
export function readingTone(reading: MachineReading): Tone {
  switch (reading.kind) {
    case "queued":
    case "working":
    case "reconnecting":
      return "busy";
    case "failed":
    case "reconnectFailed":
    case "signInRefused":
      return "danger";
    case "ready":
      // A held connection is a live link, not a verdict: blue, never green.
      return "link";
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

/**
 * Whether the machine's server must be restarted before anything streams from it: it answers
 * requests and never the API socket, so it is a process older than the build it reports.
 */
export function needsRestart(machine: MachineInfo): boolean {
  return !machine.local && machine.socket?.state === "unanswered";
}

/**
 * Whether a new conversation can start on a machine now — the card's Use: this server always,
 * another machine while it is connected and nothing is moving on it.
 */
export function canUse(machine: MachineInfo, job: MachineJob | null): boolean {
  if (machine.local) return true;
  if (job !== null && (job.queued || job.running)) return false;
  return machine.reconnect === undefined && machine.connection !== null;
}

/** The tone each socket state's mark carries — see `socketReading`, which is where it is read. */
const SOCKET_TONE: Record<MachineSocketFact["state"], Tone> = {
  // A completed handshake is a live connection held right now: blue, never green — the same
  // reading `ready` gets, and for the same reason, it is contact rather than a verdict.
  connected: "link",
  // A dial in flight is work under way.
  dialling: "busy",
  // The machine answered the handshake with a status (a program predating the socket): not
  // broken, but nothing will stream until it is brought forward.
  refused: "attention",
  // Its server answers and never takes the handshake: nothing streams until it is restarted.
  unanswered: "attention",
  // The dial did not complete, or a socket that was up closed: the far side's words are there
  // when there are any, and this is what needs a person.
  failed: "danger",
};

/** `machine.socket` as the detail list reads it: the word, its mark's tone, since when, and the transport's words. */
export interface SocketReading {
  /** The state in a word, localized like the rest of the detail list. */
  label: string;
  tone: Tone;
  /** The instant that state was entered (ISO) — shown with the same format as `status.checkedAt`. */
  since: string;
  /** The transport's own words where there are any: a refusal's status, a dial's error. */
  detail: string | null;
}

/**
 * The API socket this server holds to the machine (machines/machine-sockets.ts), for the detail
 * list — or null when there is none: the local entry, which needs no socket, and every machine
 * until a stream has asked for one at all.
 *
 * A fact about one process on THIS side, exactly like `connection`, and read for the same
 * reason it is not the card's own reading: it says a socket exists and what it is doing, never
 * that the far side is answering. What makes it worth a line of its own is the case the card
 * cannot show — a socket that stays connected while the machine's stream has gone quiet — and
 * `since`, which turns "dialling" into "dialling for two minutes".
 */
export function socketReading(machine: MachineInfo): SocketReading | null {
  const socket = machine.socket;
  if (!socket) return null;
  return {
    label: S.machines.socket[socket.state],
    tone: SOCKET_TONE[socket.state],
    since: socket.since,
    detail: socket.detail ?? null,
  };
}

/**
 * Whether Sync config is offered: a connected machine on this server's build. One on another
 * build is offered Update instead, which hands the config over as it reconnects.
 */
export function canSyncConfig(machine: MachineInfo, imageVersion: string | null): boolean {
  return (
    !machine.local &&
    machine.installed !== null &&
    machine.connection !== null &&
    machine.reconnect === undefined &&
    !outOfDate(machine, imageVersion)
  );
}

/**
 * Why Use waits, said in the card's middle while no job moves there; null when it does not
 * wait, or when something else in the middle already says what is happening — the job's stepper,
 * or the retry status while the server brings the machine back or stopped trying (retryReading).
 */
export function useWaitsBecause(
  machine: MachineInfo,
  job: MachineJob | null,
  reading: MachineReading | null,
): string | null {
  if (reading === null || canUse(machine, job)) return null;
  const why = S.machines.card.why;
  switch (reading.kind) {
    case "queued":
    case "working":
    case "reconnecting":
    case "reconnectFailed":
    case "reconnectStopped":
    case "signInRefused":
      return null;
    case "failed":
      return why.failed;
    case "notInstalled":
      return why.notInstalled;
    case "installedOnly":
      return why.windows;
    case "stopped":
      return why.stopped;
    default:
      // Not connected — out of reach, never checked or on another build included: nothing says
      // its server is stopped, only that nothing holds a connection to it.
      return why.notConnected;
  }
}

/**
 * The retry row a machine shows while the server brings it back, or after it stopped trying —
 * the card's middle, the dialog's Reconnecting section and a conversation on that machine, as the
 * shared `RetryStatus` draws it.
 */
export interface RetryReading {
  phase: RetryPhase;
  /**
   * Where things stand, in one sentence: the attempt running of how many, or where it stopped.
   * While waiting, what the row says once the moment has come.
   */
  label: string;
  /** While waiting: the sentence for the seconds left; null otherwise. */
  countdown: ((seconds: number) => string) | null;
  /** Behind the row's "?": the last failure, or the fix; null when there is nothing to explain. */
  reason: string | null;
  /** The "?" panel's title over the reason ("Last failure"); null when the reason is the fix. */
  reasonTitle: string | null;
  /** When the next attempt runs, in epoch ms, while one is waited for; null otherwise. */
  nextAtMs: number | null;
  /** The presses on offer: Retry now and Stop retrying while it runs, Retry once it stopped. */
  offers: { retryNow: boolean; stop: boolean; retry: boolean };
}

const RUNNING = { retryNow: false, stop: true, retry: false };
const WAITING = { retryNow: true, stop: true, retry: false };
const STOPPED = { retryNow: false, stop: false, retry: true };
const NOTHING = { retryNow: false, stop: false, retry: false };

/**
 * The retry row for a reading; null for a machine that is not being brought back. The attempt a
 * row names is the one past the failures so far — running, or waited for. Stop retrying is on
 * offer for as long as the streak runs; Retry once it stopped, at its limit, at an ssh refusal no
 * retry mends, or by a person's stop. A refused password offers nothing: another try could lock
 * the account, and saving its password tries again on its own.
 */
export function retryReading(reading: MachineReading, alias: string): RetryReading | null {
  const r = S.machines.retry;
  switch (reading.kind) {
    case "reconnecting": {
      const n = reading.attempts + 1;
      const m = reading.maxAttempts;
      const failure = lastFailure(reading.message);
      return reading.nextAt === null
        ? {
            phase: "trying",
            label: r.trying(n, m),
            countdown: null,
            ...failure,
            nextAtMs: null,
            offers: RUNNING,
          }
        : {
            phase: "waiting",
            label: r.trying(n, m),
            countdown: (seconds) => r.waiting(seconds, n, m),
            ...failure,
            nextAtMs: Date.parse(reading.nextAt),
            offers: WAITING,
          };
    }
    case "reconnectFailed":
      return reading.why === "ssh"
        ? {
            phase: "blocked",
            label: r.stoppedSsh,
            countdown: null,
            // The sentence for an ssh refusal is its fix already.
            reason: reading.message,
            reasonTitle: null,
            nextAtMs: null,
            offers: STOPPED,
          }
        : {
            phase: "gaveUp",
            label: r.gaveUp(reading.maxAttempts),
            countdown: null,
            ...lastFailure(reading.message),
            nextAtMs: null,
            offers: STOPPED,
          };
    case "reconnectStopped":
      return {
        phase: "cancelled",
        label: r.cancelled,
        countdown: null,
        ...lastFailure(reading.message),
        nextAtMs: null,
        offers: STOPPED,
      };
    case "signInRefused":
      return {
        phase: "blocked",
        label: r.stoppedPassword,
        countdown: null,
        // What to do about it, not only that it happened.
        reason: S.machines.check.ssh[reading.reason](alias),
        reasonTitle: null,
        nextAtMs: null,
        offers: NOTHING,
      };
    default:
      return null;
  }
}

/** The last failure behind the "?", under its title; nothing before the first one. */
function lastFailure(message: string | null): {
  reason: string | null;
  reasonTitle: string | null;
} {
  return message === null
    ? { reason: null, reasonTitle: null }
    : { reason: message, reasonTitle: S.machines.retry.lastFailure };
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
