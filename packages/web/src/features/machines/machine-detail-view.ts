/**
 * What the Machine dialog says about one machine, derived without a DOM: the status chip under
 * its title, the facts with their glyphs, the job's steps, the one thing to do next, the verbs
 * Actions lists, and why a verb is held.
 *
 * Every derivation reads the reading the card reads (`readMachine`), so the dialog and the card
 * never disagree about a machine's state: the dialog only says more of it.
 */
import type {
  MachineCheck,
  MachineInfo,
  MachineJob,
  MachinePhase,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import { ICONS } from "@prismshadow/penguin-ui";
import {
  formatBytes,
  formatDateTime,
  formatRelativeLong,
  formatShortDateTime,
} from "../../lib/format";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import { reasonText } from "./machine-card";
import type { MachineVerb } from "./machine-detail-dialog";
import {
  MACHINE_PHASES,
  failureText,
  isPhase,
  readingTone,
  sshWords,
  stepLabel,
} from "./machines-view";
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
  notInstalled: ICONS.download,
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

/**
 * One fact of the Details section: its glyph and label, and its value in words — with whatever
 * stands behind the value said beside it or under it, never on a hover the reader has to find.
 */
export interface Fact {
  key: FactKey;
  /** The label's glyph, from `ICONS`. */
  icon: string;
  label: string;
  value: string;
  /** Said after the value in the muted ink: the time itself, beside how long ago it was. */
  aside?: string;
  /** A muted line under the value: ssh's own words under "Unreachable". */
  note?: string;
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

/**
 * The server over there, in words: running on its port, not running, or out of reach — with
 * ssh's own words under it when there are any.
 */
function serviceValue(status: NonNullable<MachineInfo["status"]>): Pick<Fact, "value" | "note"> {
  const f = S.machines.detail.fact;
  if (status.state === "running") {
    return {
      value: status.port === undefined ? S.machines.state.serving : f.running(status.port),
    };
  }
  if (status.state === "stopped") return { value: f.stopped };
  return status.detail === undefined
    ? { value: f.unreachable }
    : { value: f.unreachable, note: status.detail };
}

/**
 * The last check: how long ago, and beside it the time itself — unless how long ago is already
 * said as a time (a week or more, or a clock running ahead), or the stamp cannot be read.
 */
function checkedValue(
  checkedAt: string,
  locale: "zh" | "en",
  now: number,
): Pick<Fact, "value" | "aside"> {
  const ago = formatRelativeLong(checkedAt, locale, now);
  if (ago === "" || ago === formatDateTime(checkedAt)) return { value: ago };
  return { value: ago, aside: formatShortDateTime(checkedAt) };
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
      ...checkedValue(status.checkedAt, locale, now),
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
 * them all done, and a failed one is marked failed at its phase — or, when it stopped before
 * naming one (ssh refused the sign-in every job opens with), at the step its failure names.
 */
export function jobSteps(job: MachineJob): JobStep[] {
  const failure = failedResult(job);
  const failed = failure !== null;
  const phase = job.phase ?? (failure !== null && isPhase(failure.step) ? failure.step : null);
  const at = phase === null ? -1 : MACHINE_PHASES.indexOf(phase);
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
      /** Why: an ssh refusal in the reader's language, anything else in the far side's words. */
      message: string;
      /** ssh's own words under a refusal it caused; null otherwise. */
      detail: string | null;
      canReplaceProgram: boolean;
    };

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
    stepName: stepLabel(result.step),
    ...failureText(result, job.alias),
    canReplaceProgram: result.canReplaceProgram === true,
  };
}

export type PrimaryKind = "enable" | "update" | "start" | "connect" | "tryAgain" | "retry";

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
  if (reading.kind === "notInstalled") {
    return { kind: "enable", label: p.enable, glyph: ICONS.plug, why: p.enableWhy };
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

/** One single step or way out as Actions lists it: its glyph, its word, and what it does. */
export interface VerbRow {
  verb: DialogVerb;
  glyph: string;
  label: string;
  /** What the verb does, in one line beside its button. */
  why: string;
}

/** A group of Actions: its caption, and its verbs in order. */
export interface VerbGroup {
  caption: string;
  rows: VerbRow[];
}

/**
 * Actions' two groups, in order: the single steps, then the ways out. Reconnect stays out where
 * the one thing to do already connects — Connect and Try again run the whole pipeline, which
 * connects and more — so the same act is never offered twice.
 */
export function verbGroups(primary: PrimaryKind | null): VerbGroup[] {
  const m = S.machines;
  const connects = primary === "connect" || primary === "tryAgain" || primary === "enable";
  const maintenance: VerbRow[] = [
    { verb: "install", glyph: ICONS.download, label: m.verbs.install, why: m.verbs.installWhy },
    { verb: "connect", glyph: ICONS.chainLink, label: m.verbs.connect, why: m.verbs.connectWhy },
    { verb: "restart", glyph: ICONS.rotateCw, label: m.verbs.restart, why: m.verbs.restartWhy },
    { verb: "check", glyph: ICONS.gauge, label: m.verbs.check, why: m.verbs.checkWhy },
    {
      verb: "configure",
      glyph: ICONS.gear,
      label: m.detail.configureSsh,
      why: m.detail.configureSshWhy,
    },
  ];
  const leave: VerbRow[] = [
    { verb: "stopUsing", glyph: ICONS.plugLifted, label: m.stopUsing, why: m.verbs.stopUsingWhy },
    {
      verb: "disconnect",
      glyph: ICONS.signOut,
      label: m.verbs.disconnect,
      why: m.verbs.disconnectWhy,
    },
    { verb: "release", glyph: ICONS.boxArrowOut, label: m.verbs.release, why: m.verbs.releaseWhy },
  ];
  return [
    {
      caption: m.detail.maintenance,
      rows: maintenance.filter((row) => !(connects && row.verb === "connect")),
    },
    { caption: m.detail.leave, rows: leave },
  ];
}

/**
 * Why a verb waits on the machine: a job on its way, a check already running, no build, nothing
 * installed, no connection, no answer.
 */
export type HoldReason =
  "moving" | "checking" | "noImage" | "notInstalled" | "noConnection" | "unreachable";

/** Why a verb waits: a request in flight, or a reason of the machine's own. */
export type Hold = "busy" | HoldReason;

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
  /** This Project has installed the program there (an added machine has not, yet). */
  installed: boolean;
  /** A connection check is running for the machine. */
  checking: boolean;
}

/** What of the machine's own can hold each verb, in the order the reasons are told. */
const HOLDS: Record<DialogVerb, readonly HoldReason[]> = {
  install: ["moving", "noImage"],
  connect: ["moving", "notInstalled"],
  restart: ["moving", "notInstalled", "unreachable"],
  check: ["moving", "checking"],
  configure: [],
  stopUsing: [],
  disconnect: ["noConnection"],
  release: [],
};

const holds = (hold: HoldReason, ctx: VerbContext): boolean => {
  switch (hold) {
    case "moving":
      return ctx.moving;
    case "checking":
      return ctx.checking;
    case "noImage":
      return ctx.noImage;
    case "notInstalled":
      return !ctx.installed;
    case "noConnection":
      return !ctx.connected;
    case "unreachable":
      return ctx.unreachable;
  }
};

/**
 * Why a verb waits on the machine, or null when nothing of the machine's holds it; the first
 * reason wins. A request in flight is not among them: it holds every verb for the moment the
 * request takes, which is no reason to rewrite what each one says.
 */
export function holdReason(verb: DialogVerb, ctx: VerbContext): HoldReason | null {
  return HOLDS[verb].find((hold) => holds(hold, ctx)) ?? null;
}

/**
 * Why a verb is held right now, or null when it may be pressed: a request in flight holds every
 * verb and is told before any other reason.
 */
export function verbHold(verb: DialogVerb, ctx: VerbContext): Hold | null {
  return ctx.busy ? "busy" : holdReason(verb, ctx);
}

/** One line of the connection check: its mark, its sentence, and ssh's own words under it. */
export interface CheckLine {
  id: MachineCheck["id"];
  state: MachineCheck["state"];
  /** A check for pass, an alert for a caveat, a cross for a failure; null (a dot) when not asked. */
  glyph: string | null;
  tone: Tone;
  text: string;
  /** ssh's own words under a sign-in that failed; null otherwise. */
  detail: string | null;
}

const CHECK_MARK: Record<MachineCheck["state"], { glyph: string | null; tone: Tone }> = {
  pass: { glyph: ICONS.check, tone: "success" },
  warn: { glyph: ICONS.triangleAlert, tone: "attention" },
  fail: { glyph: ICONS.xCircle, tone: "danger" },
  skip: { glyph: null, tone: "muted" },
};

/** An OS as people name it. */
const OS_NAME: Record<string, string> = { linux: "Linux", darwin: "macOS", win32: "Windows" };

/**
 * A check as one plain sentence in the page's language, from the facts the server found — what
 * the machine has, and when it falls short, what to do. A sign-in that failed carries ssh's own
 * words under it.
 */
export function checkLine(check: MachineCheck, alias: string): CheckLine {
  const c = S.machines.check;
  const mark = CHECK_MARK[check.state];
  const line = (text: string, detail: string | null = null): CheckLine => ({
    id: check.id,
    state: check.state,
    ...mark,
    text,
    detail,
  });
  if (check.state === "skip") return line(c.skipped(c.name[check.id]));
  const size = (mb: number) => formatBytes(mb * 1024 * 1024);
  switch (check.id) {
    case "ssh":
      return check.state === "pass"
        ? line(c.sshPass(check.user, check.host))
        : line(c.ssh[check.reason](alias), c.sshSaid(sshWords(check.said)));
    case "platform":
      if (check.state === "fail") {
        if (check.reason === "glibc") {
          return line(c.platformOldGlibc(check.glibc ?? "?", check.need ?? "?"));
        }
        if (check.reason === "musl") return line(c.platformMusl);
        return line(c.platformUnsupported, check.said || null);
      }
      if (check.state === "warn" && check.terminalsNeed !== undefined) {
        return line(c.platformTerminals(check.arch, check.glibc ?? "?", check.terminalsNeed));
      }
      return check.state === "warn"
        ? line(c.platformWindows)
        : line(c.platform(OS_NAME[check.os] ?? check.os, check.arch));
    case "tools":
      if (check.state === "pass") return line(c.toolsPass);
      return check.state === "warn"
        ? line(c.toolsNoCurl)
        : line(c.toolsMissing(check.missing.join(", ")));
    case "download":
      if (check.state === "pass") {
        const github = check.github === "ok";
        const oss = check.oss === "ok";
        return line(
          c.downloadFrom(check.version, github && oss ? "both" : github ? "github" : "oss"),
        );
      }
      return check.state === "warn"
        ? line(c.downloadCarried(check.version))
        : line(c.downloadMissing(check.version));
    case "disk":
      if (check.state === "pass") return line(c.diskPass(size(check.freeMb)));
      return check.state === "warn"
        ? line(c.diskTight(size(check.freeMb)))
        : line(c.diskLow(size(check.freeMb), size(check.needMb)));
    case "port":
      return check.holder === "other"
        ? line(c.portTaken(check.port))
        : check.holder === "penguin"
          ? line(c.portOurs(check.port))
          : line(c.portFree(check.port));
  }
}
