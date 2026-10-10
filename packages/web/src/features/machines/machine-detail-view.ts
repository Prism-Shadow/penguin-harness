/**
 * What the Machine dialog says about one machine, derived without a DOM: the status chip under
 * its title, the facts with their glyphs, the job's steps, the one thing to do next, and why a
 * verb is held.
 *
 * Every derivation reads the reading the card reads (`readMachine`), so the dialog and the card
 * never disagree about a machine's state: the dialog only says more of it.
 */
import type {
  MachineInfo,
  MachineJob,
  MachinePhase,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import { ICONS } from "@prismshadow/penguin-ui";
import { formatDateTime, formatRelativeLong } from "../../lib/format";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import { reasonText } from "./machine-card";
import type { MachineVerb } from "./machine-detail-dialog";
import { MACHINE_PHASES, readingTone } from "./machines-view";
import type { MachineReading } from "./machines-view";

/** The machine's state as one chip: a glyph (or a spinner) and one plain word. */
export interface MachineChip {
  /** The state's one word (`S.machines.state[kind]`; `serving` for this server's own entry). */
  word: string;
  tone: Tone;
  /** A registry path; null for a working machine, which wears a spinner instead. */
  glyph: string | null;
  /** The reason behind the word, on hover; null when the word says it all. */
  reason: string | null;
}

/**
 * The shape beside each state's word. Two states that share a tone (a stopped machine and one out
 * of reach are both amber) still read apart by it.
 */
const CHIP_GLYPH: Record<MachineReading["kind"], string | null> = {
  ready: ICONS.chainLink,
  notConnected: ICONS.plugLifted,
  stopped: ICONS.stopCircle,
  linkedStopped: ICONS.stopCircle,
  unreachable: ICONS.alertCircle,
  behind: ICONS.refresh,
  installedOnly: ICONS.checkCircle,
  queued: ICONS.hourglass,
  working: null,
  failed: ICONS.xCircle,
  unknown: ICONS.helpCircle,
};

/**
 * The chip for a reading; `reading` is null for this server's own entry, which is simply running.
 * The reason is the far side's own words where there are any — the failure, ssh's diagnostic, the
 * line a working job is on — and, for a machine on another build, the version it would get.
 */
export function machineChip(
  reading: MachineReading | null,
  imageVersion: string | null,
): MachineChip {
  if (reading === null) {
    return { word: S.machines.state.serving, tone: "link", glyph: ICONS.house, reason: null };
  }
  return {
    word: S.machines.state[reading.kind],
    tone: readingTone(reading),
    glyph: CHIP_GLYPH[reading.kind],
    reason:
      reading.kind === "behind"
        ? imageVersion === null
          ? null
          : S.machines.detail.newerAvailable(imageVersion)
        : reasonText(reading),
  };
}

/** `user@host:port`, the way ssh itself would be told; the default port goes unsaid. */
export function hostLine(host: SshHostResponse): string {
  const user = host.user === undefined || host.user === "" ? "" : `${host.user}@`;
  const port = host.port === undefined || host.port === 22 ? "" : `:${host.port}`;
  return `${user}${host.hostName}${port}`;
}

export type FactKey =
  | "connection"
  | "host"
  | "root"
  | "service"
  | "checked"
  | "installed"
  | "installedAt"
  | "machineId";

/** One fact of the Details section: its glyph and label, and its value in words. */
export interface Fact {
  key: FactKey;
  /** The label's glyph, from `ICONS`. */
  icon: string;
  label: string;
  value: string;
  /** Hover text: the absolute time behind a relative one, ssh's own words behind 「连不上」. */
  tooltip?: string;
  /** The value is an identifier: an alias, an address, a path, an id. */
  mono?: boolean;
  /** The id row: muted like its label, a copy button beside it. */
  quiet?: boolean;
}

/**
 * The installed version as a reader wants it: with whether it is the one this server would
 * install. This server's own entry, and a server with no build to compare against, say the bare
 * version.
 */
export function installedText(
  installed: { version: string } | null,
  imageVersion: string | null,
  local: boolean,
): { version: string; note: "latest" | "behind" | null } {
  const version = installed?.version ?? "";
  if (installed === null || local || imageVersion === null) return { version, note: null };
  return { version, note: version === imageVersion ? "latest" : "behind" };
}

/** The server over there, in words: running on its port, not running, or out of reach. */
function serviceValue(status: NonNullable<MachineInfo["status"]>): Pick<Fact, "value" | "tooltip"> {
  const f = S.machines.detail.fact;
  if (status.state === "running") {
    return {
      value: status.port === undefined ? S.machines.state.serving : f.running(status.port),
    };
  }
  if (status.state === "stopped") return { value: f.stopped };
  return status.detail === undefined
    ? { value: f.unreachable }
    : { value: f.unreachable, tooltip: status.detail };
}

/**
 * The Details section, in two columns — where the machine is (how it is reached, the address its
 * alias names, the data directory) and how it stands (the server over there, the last check, the
 * build it carries) — and the machine's own id, last and full width. `host` is null until the
 * dialog has read the host block, or when the config has none this app can read; `now` is the
 * clock the last check is measured from.
 */
export function machineFacts(
  machine: MachineInfo,
  host: SshHostResponse | null,
  imageVersion: string | null,
  locale: "zh" | "en",
  now: number,
): { left: Fact[]; right: Fact[]; id: Fact | null } {
  const f = S.machines.detail.fact;
  const local = machine.local;
  const left: Fact[] = [
    local
      ? { key: "connection", icon: ICONS.house, label: f.connection, value: f.local }
      : {
          key: "connection",
          icon: ICONS.terminalPrompt,
          label: f.connection,
          value: f.viaSsh(machine.alias),
          mono: true,
        },
  ];
  if (!local && host !== null) {
    left.push({ key: "host", icon: ICONS.globe, label: f.host, value: hostLine(host), mono: true });
  }
  left.push({ key: "root", icon: ICONS.folder, label: f.root, value: machine.root, mono: true });

  const right: Fact[] = [];
  const status = machine.status;
  if (status !== null) {
    right.push({
      key: "service",
      icon: ICONS.pulse,
      label: local ? f.serviceLocal : f.service,
      ...serviceValue(status),
    });
    right.push({
      key: "checked",
      icon: ICONS.clock,
      label: f.checked,
      value: formatRelativeLong(status.checkedAt, locale, now),
      tooltip: formatDateTime(status.checkedAt),
    });
  }
  const installed = machine.installed;
  if (installed !== null) {
    const { version, note } = installedText(installed, imageVersion, local);
    right.push({
      key: "installed",
      icon: ICONS.hardDrive,
      label: local ? f.version : f.installed,
      value:
        note === "latest"
          ? f.latest(version)
          : note === "behind" && imageVersion !== null
            ? f.behind(version, imageVersion)
            : version,
    });
    right.push({
      key: "installedAt",
      icon: ICONS.calendar,
      label: local ? f.started : f.installedAt,
      value: formatDateTime(installed.at),
    });
  }

  const id: Fact | null =
    machine.machineId === null
      ? null
      : {
          key: "machineId",
          icon: ICONS.hash,
          label: f.machineId,
          value: machine.machineId,
          mono: true,
          quiet: true,
        };
  return { left, right, id };
}

export type StepState = "done" | "current" | "failed" | "pending";

export interface JobStep {
  phase: MachinePhase;
  name: string;
  state: StepState;
}

/** A finished job that did not go through. */
const failedResult = (job: MachineJob) =>
  !job.queued && !job.running && job.result !== null && !job.result.ok ? job.result : null;

/**
 * The six steps in order, each marked by where the job stands: a queued job has every step still
 * to come, a running one is on its phase with the earlier ones done, one that finished well has
 * them all done, and a failed one is marked failed at its phase.
 */
export function jobSteps(job: MachineJob): JobStep[] {
  const at = job.phase === null ? -1 : MACHINE_PHASES.indexOf(job.phase);
  const failed = failedResult(job) !== null;
  const stateOf = (index: number): StepState => {
    if (job.queued) return "pending";
    if (!job.running && !failed) return "done";
    if (index < at) return "done";
    if (index > at) return "pending";
    return failed ? "failed" : "current";
  };
  return MACHINE_PHASES.map((phase, index) => ({
    phase,
    name: S.machines.step[phase],
    state: stateOf(index),
  }));
}

/** What the Progress section shows for a job. */
export type JobView =
  | { kind: "queued"; steps: JobStep[] }
  | { kind: "running"; steps: JobStep[] }
  | { kind: "done" }
  | {
      kind: "failed";
      steps: JobStep[];
      /** The failed step by name, or the server's own word for a step that is not a phase. */
      stepName: string;
      /** The far side's own words. */
      message: string;
      canReplaceProgram: boolean;
    };

const isPhase = (step: string): step is MachinePhase =>
  (MACHINE_PHASES as readonly string[]).includes(step);

/**
 * The job as the Progress section shows it: its steps while it is queued or running, or after it
 * failed — with where and why — and nothing but a line once it finished well.
 */
export function jobView(job: MachineJob): JobView {
  if (job.queued) return { kind: "queued", steps: jobSteps(job) };
  if (job.running) return { kind: "running", steps: jobSteps(job) };
  const result = failedResult(job);
  if (result === null) return { kind: "done" };
  return {
    kind: "failed",
    steps: jobSteps(job),
    stepName: isPhase(result.step) ? S.machines.step[result.step] : result.step,
    message: result.message,
    canReplaceProgram: result.canReplaceProgram === true,
  };
}

export type PrimaryKind = "update" | "start" | "connect" | "tryAgain" | "retry";

/** The one thing to do for a machine: its button's word and glyph, and what it does. */
export interface PrimaryAction {
  kind: PrimaryKind;
  label: string;
  glyph: string;
  why: string;
}

/**
 * The one thing to do for this machine; every kind asks for the `use` verb — the whole pipeline,
 * which installs, starts and connects as far as the machine needs. Null while a job is queued or
 * running, and for a machine that is ready or installed as far as it goes. A failed job's Retry
 * is drawn under the failure, every other kind at the top of Actions.
 */
export function primaryAction(
  reading: MachineReading,
  outOfDate: boolean,
  imageVersion: string | null,
): PrimaryAction | null {
  const p = S.machines.detail.primary;
  if (reading.kind === "queued" || reading.kind === "working") return null;
  if (reading.kind === "failed") {
    return { kind: "retry", label: p.retry, glyph: ICONS.rotateCcw, why: p.retryWhy };
  }
  if (outOfDate && imageVersion !== null) {
    return {
      kind: "update",
      label: p.update,
      glyph: ICONS.refresh,
      why: p.updateWhy(imageVersion),
    };
  }
  switch (reading.kind) {
    case "ready":
    case "installedOnly":
      return null;
    case "stopped":
    case "linkedStopped":
      return { kind: "start", label: p.start, glyph: ICONS.play, why: p.startWhy };
    case "unreachable":
      return { kind: "tryAgain", label: p.tryAgain, glyph: ICONS.plug, why: p.tryAgainWhy };
    default:
      // Not connected, never checked — and a build with nothing to compare it against, which
      // reads like a machine nobody is connected to.
      return { kind: "connect", label: p.connect, glyph: ICONS.plug, why: p.connectWhy };
  }
}

/** The single steps and the ways out; `use` and `replaceProgram` are the primary's. */
export type DialogVerb = Exclude<MachineVerb, "use" | "replaceProgram">;

/** Why a verb waits: a request in flight, a job on its way, no build, no connection, no answer. */
export type Hold = "busy" | "moving" | "noImage" | "noConnection" | "unreachable";

export interface VerbContext {
  /** A request from the page is in flight. */
  busy: boolean;
  /** A job for the machine is queued or running: the single steps would collide with it (409). */
  moving: boolean;
  /** This server has no build to push. */
  noImage: boolean;
  /** A connection to the machine is held. */
  connected: boolean;
  /** The last probe could not reach the machine. */
  unreachable: boolean;
}

/** What can hold each verb, in the order the reasons are told. */
const HOLDS: Record<DialogVerb, readonly Hold[]> = {
  install: ["busy", "moving", "noImage"],
  connect: ["busy", "moving"],
  restart: ["busy", "moving", "unreachable"],
  configure: ["busy"],
  stopUsing: ["busy"],
  disconnect: ["busy", "noConnection"],
  release: ["busy"],
};

const holds = (hold: Hold, ctx: VerbContext): boolean => {
  switch (hold) {
    case "busy":
      return ctx.busy;
    case "moving":
      return ctx.moving;
    case "noImage":
      return ctx.noImage;
    case "noConnection":
      return !ctx.connected;
    case "unreachable":
      return ctx.unreachable;
  }
};

/** Why a verb is held right now, or null when it may be pressed. The first reason wins. */
export function verbHold(verb: DialogVerb, ctx: VerbContext): Hold | null {
  return HOLDS[verb].find((hold) => holds(hold, ctx)) ?? null;
}
