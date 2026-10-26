/**
 * What the Machine dialog says about one machine, derived without a DOM: the status chip under
 * its title, the toolbar's verbs and the one sentence on those that wait, the reconnecting
 * section, the job's steps, and the facts with their glyphs.
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
import type { MachineState } from "@prismshadow/penguin-ui";
import {
  formatBytes,
  formatDateTime,
  formatRelativeLong,
  formatShortDateTime,
  formatSpan,
} from "../../lib/format";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";
import { reasonText } from "./machine-card";
import {
  canSyncConfig,
  failureText,
  isPhase,
  outOfDate,
  readMachine,
  readingTone,
  retryReading,
  sshWords,
  stepLabel,
} from "./machines-view";
import type { MachineReading, RetryReading } from "./machines-view";

/** The machine's state as one pill: one plain word in the state's tone. */
export interface MachineChip {
  /** The state the shared status pill draws (`MachineStatusPill`). */
  state: MachineState;
  /** The state's one word (`S.machines.state[kind]`; `serving` for this server's own entry). */
  word: string;
  tone: Tone;
  /** The reason behind the word, on hover; null when the word says it all. */
  reason: string | null;
}

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
    return {
      state: "serving",
      word: S.machines.state.serving,
      tone: "link",
      reason: null,
    };
  }
  return {
    state: reading.kind,
    word: S.machines.state[reading.kind],
    tone: readingTone(reading),
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
 * The job's own steps in order, each marked by where the job stands: a queued job has every step
 * still to come, a running one is on its phase with the earlier ones done, one that finished well
 * has them all done, and a failed one is marked failed at its phase — or, when it stopped before
 * naming one (ssh refused the sign-in every job opens with), at the step its failure names.
 */
export function jobSteps(job: MachineJob): JobStep[] {
  const failure = failedResult(job);
  const failed = failure !== null;
  const phase = job.phase ?? (failure !== null && isPhase(failure.step) ? failure.step : null);
  const at = phase === null ? -1 : job.steps.indexOf(phase);
  const stateOf = (index: number): StepState => {
    if (job.queued) return "pending";
    if (!job.running && !failed) return "done";
    if (index < at) return "done";
    if (index > at) return "pending";
    return failed ? "failed" : "current";
  };
  return job.steps.map((phase, index) => ({
    phase,
    name: S.machines.step[phase],
    state: stateOf(index),
  }));
}

/** The connection check the server ran after a job failed: still running, or its lines. */
export type JobCheck = { kind: "running" } | { kind: "done"; lines: CheckLine[] };

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
      /** The connection check the server ran after the failure; null when it ran none. */
      check: JobCheck | null;
    };

/**
 * The job as the Progress section shows it: its steps while it is queued or running, or after it
 * failed — with where and why, and what the connection check found — and nothing but a line once
 * it finished well.
 */
export function jobView(job: MachineJob): JobView {
  if (job.queued) return { kind: "queued", steps: jobSteps(job) };
  if (job.running) return { kind: "running", steps: jobSteps(job) };
  const result = failedResult(job);
  if (result === null) return { kind: "done" };
  const diagnosis = job.diagnosis;
  return {
    kind: "failed",
    steps: jobSteps(job),
    stepName: stepLabel(result.step),
    ...failureText(result, job.alias),
    canReplaceProgram: result.canReplaceProgram === true,
    check:
      diagnosis === undefined
        ? null
        : diagnosis.state === "running"
          ? { kind: "running" }
          : { kind: "done", lines: diagnosis.checks.map((one) => checkLine(one, job.alias)) },
  };
}

/** The toolbar's verbs, by what each one does. */
export type ToolbarVerb =
  "enable" | "update" | "stop" | "start" | "restart" | "syncConfig" | "configure" | "uninstall";

/** Why a toolbar verb waits: a job on its way, a machine out of reach, a stopped server, no build. */
export type HoldReason = "moving" | "unreachable" | "stopped" | "noImage";

/** One button of the toolbar: its verb, word and glyph, whether it is the primary, and why it waits. */
export interface ToolbarItem {
  verb: ToolbarVerb;
  label: string;
  glyph: string;
  primary: boolean;
  /** Why it cannot run now; null when it can. */
  held: HoldReason | null;
}

const GLYPH: Record<ToolbarVerb, string> = {
  enable: ICONS.plug,
  update: ICONS.refresh,
  stop: ICONS.stopCircle,
  start: ICONS.play,
  restart: ICONS.rotateCw,
  // The config leaving this server for that machine.
  syncConfig: ICONS.upload,
  configure: ICONS.slidersHorizontal,
  uninstall: ICONS.trash,
};

/** The order the one sentence tells the reasons in: the first that holds any verb is said. */
const REASONS: readonly HoldReason[] = ["moving", "unreachable", "stopped", "noImage"];

/**
 * The toolbar under the dialog's header: every verb the machine takes now, in one row, and the
 * one sentence saying why those that wait do. A machine with nothing installed is enabled (the
 * whole pipeline); one on another build than this server's is updated — the same pipeline,
 * offered only while it would change something; then its server stopped or started (whichever
 * it is not), restarted, its config synced (only while it is connected and on this server's
 * build), its ssh host configured, and the program uninstalled. This server's own entry takes
 * none.
 */
export function machineToolbar(
  machine: MachineInfo,
  job: MachineJob | null,
  imageVersion: string | null,
  noImage: boolean,
): { items: ToolbarItem[]; sentence: string | null } {
  if (machine.local) return { items: [], sentence: null };
  const t = S.machines.detail.toolbar;
  const moving = job !== null && (job.queued || job.running);
  const reconnecting = machine.reconnect !== undefined;
  const kept = machine.keepConnected === true || machine.connection !== null;
  const item = (
    verb: ToolbarVerb,
    label: string,
    held: HoldReason | null,
    primary = false,
  ): ToolbarItem => ({ verb, label, glyph: GLYPH[verb], primary, held });
  const pipelineHeld: HoldReason | null = moving ? "moving" : noImage ? "noImage" : null;
  const items: ToolbarItem[] = [];
  if (machine.installed === null) {
    items.push(item("enable", t.enable, pipelineHeld, true));
    items.push(item("configure", t.configure, null));
  } else {
    if (outOfDate(machine, imageVersion)) items.push(item("update", t.update, pipelineHeld, true));
    const reachHeld: HoldReason | null = moving ? "moving" : reconnecting ? "unreachable" : null;
    items.push(
      kept ? item("stop", t.stop, reachHeld) : item("start", t.start, moving ? "moving" : null),
    );
    items.push(item("restart", t.restart, reachHeld ?? (kept ? null : "stopped")));
    if (canSyncConfig(machine, imageVersion)) {
      items.push(item("syncConfig", t.syncConfig, moving ? "moving" : null));
    }
    items.push(item("configure", t.configure, null));
    items.push(item("uninstall", t.uninstall, reachHeld));
  }
  const held = S.machines.detail.held;
  const reason = REASONS.find((one) => items.some((it) => it.held === one));
  const sentence = reason === undefined ? null : held[reason];
  return { items, sentence };
}

/** The last config sync, as the line under the toolbar says it, and what it could not carry. */
export interface ConfigSyncView {
  ok: boolean;
  /** 「配置已同步 · 3 分钟前」, or 「配置同步失败：…」 with the far side's words. */
  line: string;
  /** Whether some model takes a value from this server's environment, which the sync cannot carry. */
  envOnly: boolean;
  /** Each model the machine would not take, with why; empty for none. */
  skipped: string[];
}

/**
 * What the dialog says of the machine's last config sync; null before the first one since the
 * server started. A skipped model's reason is the far side's code in the reader's language where
 * the app knows it, its own words otherwise — except for one of this server's built-in models,
 * whose refusal means the machine's build does not list it yet, and says so.
 */
export function configSyncView(
  machine: MachineInfo,
  locale: "zh" | "en",
  now: number,
): ConfigSyncView | null {
  const sync = machine.configSync;
  if (sync === undefined) return null;
  const c = S.machines.detail.configSync;
  const byCode = S.errors.byCode as Record<string, string | undefined>;
  return {
    ok: sync.ok,
    line: sync.ok
      ? c.synced(formatRelativeLong(sync.at, locale, now))
      : c.failed(sync.detail ?? ""),
    envOnly: sync.envOnly.length > 0,
    skipped: sync.skipped.map((one) =>
      c.skippedModel(
        `${one.provider}/${one.modelId}`,
        one.builtInHere === true ? c.notInMachineBuild : (byCode[one.code] ?? one.reason),
      ),
    ),
  };
}

/**
 * What the "keys from this server's environment" notice is about, one item per model value the
 * sync could not carry (`projectId/provider/modelId:VARIABLE`): the set its dismissal is kept
 * against, so a model that newly takes a value from the environment brings it back.
 */
export function envOnlyItems(machine: MachineInfo): string[] {
  return (machine.configSync?.envOnly ?? []).map(
    (one) => `${one.projectId}/${one.provider}/${one.modelId}:${one.variable}`,
  );
}

/**
 * What the "models not synced to this machine" notice is about, one item per refused entry and
 * why (`projectId/provider/modelId:code`, then `:built-in` for one of this server's built-in
 * models): the set its dismissal is kept against, so another model refused, or the same one
 * refused for another reason, brings it back. The sync's time is not in it: a sync runs on its
 * own after every config edit and every reconnect, and the same refusal again is not news.
 */
export function skippedItems(machine: MachineInfo): string[] {
  return (machine.configSync?.skipped ?? []).map(
    (one) =>
      `${one.projectId}/${one.provider}/${one.modelId}:${one.code}${one.builtInHere === true ? ":built-in" : ""}`,
  );
}

/**
 * The Reconnecting section: where the streak stands — the attempt, the countdown to the next, or
 * where it stopped, with its Retry — how long it has lasted, and why the last attempt failed.
 */
export interface ReconnectView {
  /** Where the streak stands, as the shared retry status says it (the card's middle says the same). */
  status: RetryReading;
  /** How long the streak has lasted, in words. */
  lasting: string;
  /** The last attempt's failure — ssh's refusal in the reader's language; null before one. */
  lastError: string | null;
  /** ssh's own words under a refusal it caused; null otherwise. */
  detail: string | null;
  /** What the connection check found after failures in a row; null until it ran. */
  check: CheckLine[] | null;
}

export function reconnectView(
  machine: MachineInfo,
  locale: "zh" | "en",
  now: number,
): ReconnectView | null {
  const r = machine.reconnect;
  if (r === undefined) return null;
  // The reading the card gives with no job in the way: a streak is always one of these.
  const status = retryReading(readMachine(machine, null, null), machine.alias);
  if (status === null) return null;
  const failure =
    r.lastError === null
      ? null
      : failureText(
          {
            message: r.lastError,
            ...(r.sshReason === undefined ? {} : { sshReason: r.sshReason }),
          },
          machine.alias,
        );
  return {
    status,
    lasting: formatSpan(now - Date.parse(r.since), locale),
    lastError: failure?.message ?? null,
    detail: failure?.detail ?? null,
    check:
      r.diagnosis === null ? null : r.diagnosis.checks.map((one) => checkLine(one, machine.alias)),
  };
}

/**
 * Where the program lives on the machine: its data root's parent — the installer lays the data
 * root out inside the program directory — in the machine's own spelling.
 */
export function programDirOf(root: string): string {
  return root.replace(/[\\/]data$/, "");
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
