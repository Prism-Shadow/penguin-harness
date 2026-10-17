/**
 * A machine's card on the Machines page: the data wiring around the shared package's
 * `MachineCard` (`@prismshadow/penguin-ui`), which owns the band of "info | middle | quick
 * buttons" and how each part looks. This module decides what each part says from the server's
 * record and the machine's job:
 *
 * - the status pill: the reading's state (machines-view.ts `readMachine`), its word, and the
 *   reason behind it — a failure's own words, ssh's diagnostic, the line a job is on — on the
 *   pill's hover; this server's own entry is simply running;
 * - the stats: how this server reaches the machine, the build it carries, the port its server
 *   answers on, and when it was last checked;
 * - the middle: the job's stepper while a job for the machine is queued or running, else why Use
 *   waits (a hint would never open on the button, which shows its word);
 * - the buttons: Use starts a new conversation in the machine's temporary workspace, Settings
 *   opens the Machine dialog, Delete takes the machine off this Project after a confirmation, and
 *   Sync config hands a connected machine on this server's build this Project's config now. A
 *   click anywhere else on the body opens the dialog too (lib/card-open.ts).
 */
import type { MachineInfo, MachineJob } from "@prismshadow/penguin-server/api";
import {
  ICONS,
  MachineCard as MachineCardView,
  MachineStatusPill,
  MachineStepper,
} from "@prismshadow/penguin-ui";
import type {
  MachineCardFact,
  MachineState,
  MachineStatusPillProps,
  MachineStepState,
  MachineStepperProps,
  ToneName,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { cardBodyClick } from "../../lib/card-open";
import { formatRelativeShort } from "../../lib/format";
import type { Tone } from "../../lib/tone";
import {
  canSyncConfig,
  canUse,
  isPhase,
  outOfDate,
  readMachine,
  readingTone,
  stepLabel,
  useWaitsBecause,
  type MachineReading,
} from "./machines-view";

/**
 * The reason a machine's state gives beside its word, when it has one: the far side's own words,
 * after the step a failure stopped at, by the name the interface gives it.
 */
export function reasonText(reading: MachineReading): string | null {
  switch (reading.kind) {
    case "failed":
      return `${S.machines.failedAt(stepLabel(reading.step))} ${reading.message}`;
    case "unreachable":
      return reading.detail;
    case "working":
      return reading.step;
    case "reconnecting":
      return reading.attempts === 0 ? null : S.machines.detail.reconnect.attempt(reading.attempts);
    default:
      return null;
  }
}

/**
 * A machine's status pill as the card and the dialog show it: the state, its word, and the reason
 * behind it. `reading` is null for this server's own entry, which is simply running.
 */
export function machineStatus(reading: MachineReading | null): MachineStatusPillProps {
  if (reading === null) return { state: "serving", label: S.machines.state.serving };
  return {
    state: reading.kind,
    label: S.machines.state[reading.kind],
    reason: reasonText(reading),
  };
}

/** What a machine's state mark shows: its pill, and its words and tone in one record. */
export interface MachineMark {
  state: MachineState;
  /** The state's word alone, as the pill shows it. */
  word: string;
  /** What stands behind the word; null when the word says it all. */
  reason: string | null;
  /** The word with the reason beside it — the pill's whole accessible name. */
  label: string;
  tone: Tone;
  /** A job is queued or running for it. */
  moving: boolean;
}

/** A machine's mark; `reading` is null for this server's own entry, which is simply serving. */
export function machineMark(reading: MachineReading | null): MachineMark {
  const status = machineStatus(reading);
  const reason = status.reason ?? null;
  return {
    state: status.state,
    word: status.label,
    reason,
    // A failure's reason already begins by saying it failed.
    label:
      reason === null
        ? status.label
        : reading?.kind === "failed"
          ? reason
          : `${status.label} · ${reason}`,
    tone: reading === null ? "link" : readingTone(reading),
    moving: reading !== null && (reading.kind === "queued" || reading.kind === "working"),
  };
}

/**
 * The app's tones in the shared package's names, for its `Dot` and `Badge`: a busy mark takes the
 * success fill.
 */
export const DOT_TONE: Record<Tone, ToneName> = {
  busy: "success",
  attention: "attention",
  success: "success",
  link: "info",
  danger: "danger",
  muted: "neutral",
};

/** A machine's state as one labelled pill: its word on screen, the reason on hover. */
export function MachineStateMark({ mark }: { mark: MachineMark }) {
  return <MachineStatusPill state={mark.state} label={mark.word} reason={mark.reason} />;
}

/** A job is still to come or under way. */
export const jobMoving = (job: MachineJob | null): boolean =>
  job !== null && (job.queued || job.running);

/**
 * The stepper for a job: its own steps as segments — done, under way, failed at, still to come —
 * and a caption saying what the job is doing, or where a finished one ended.
 */
export function jobProgress(job: MachineJob): MachineStepperProps {
  const step = job.phase === null ? -1 : job.steps.indexOf(job.phase);
  const phase = step >= 0 ? job.steps[step] : undefined;
  const result = job.result;
  const failed = !job.queued && !job.running && result !== null && !result.ok;
  const caption = job.queued
    ? S.machines.queued
    : job.running
      ? phase !== undefined && isPhase(phase)
        ? S.machines.phase[phase]
        : S.machines.working
      : result !== null && !result.ok
        ? S.machines.failedAt(stepLabel(result.step))
        : S.machines.detail.lastJobDone;
  const stateOf = (index: number): MachineStepState => {
    if (job.queued || index > step) return "pending";
    if (index < step) return "done";
    if (failed) return "failed";
    return job.running ? "current" : "done";
  };
  return { steps: job.steps.map((_, index) => stateOf(index)), caption, running: job.running };
}

/** The job's stepper. */
export function Stepper({ job, className = "" }: { job: MachineJob; className?: string }) {
  return <MachineStepper {...jobProgress(job)} className={className} />;
}

export interface MachineCardProps {
  machine: MachineInfo;
  /** The machine's job: queued, running, or its last finished one. */
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  /** A request from this page is in flight: the buttons wait for it. */
  busy: boolean;
  /** Opens the Machine dialog. */
  onOpen: () => void;
  /** Starts a new conversation in the machine's temporary workspace. */
  onUse: () => void;
  /** Hands the machine this Project's config now (a job). */
  onSyncConfig: () => void;
  /** Asks to take the machine off this Project (the page confirms first). */
  onDelete: () => void;
}

/** The card's stats: how the machine is reached, its build, its server's port, the last check. */
function cardFacts(machine: MachineInfo, locale: "zh" | "en"): MachineCardFact[] {
  const card = S.machines.card;
  const status = machine.status;
  const port = status?.state === "running" ? (status.port ?? null) : null;
  const facts: MachineCardFact[] = [
    machine.local
      ? { glyph: ICONS.house, value: card.local }
      : { glyph: ICONS.terminalPrompt, value: card.ssh },
  ];
  if (machine.installed !== null) {
    facts.push({ glyph: ICONS.hardDrive, value: `v${machine.installed.version}` });
  }
  if (port !== null) facts.push({ glyph: ICONS.network, value: String(port) });
  if (status !== null) {
    facts.push({ glyph: ICONS.clock, value: formatRelativeShort(status.checkedAt, locale) });
  }
  return facts;
}

export function MachineCard({
  machine,
  job,
  imageVersion,
  locale,
  busy,
  onOpen,
  onUse,
  onSyncConfig,
  onDelete,
}: MachineCardProps) {
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const moving = !machine.local && jobMoving(job);
  const card = S.machines.card;
  return (
    <MachineCardView
      id={machine.id}
      alias={machine.alias}
      status={machineStatus(reading)}
      local={
        machine.local ? { tag: S.machines.localTitle, undeletable: card.localUndeletable } : null
      }
      // Another build than this server's: the pill says so and opens the dialog, where the update
      // is. Not while a job is already on its way.
      update={
        !moving && outOfDate(machine, imageVersion)
          ? { label: card.updateNeeded, onClick: onOpen }
          : null
      }
      root={machine.root}
      facts={cardFacts(machine, locale)}
      progress={moving && job !== null ? jobProgress(job) : null}
      waits={useWaitsBecause(machine, job, reading, locale, Date.now())}
      onOpen={onOpen}
      onBodyClick={cardBodyClick(onOpen)}
      use={{ label: card.use, disabled: busy || !canUse(machine, job), onClick: onUse }}
      settingsLabel={card.settings}
      remove={{ label: card.delete, disabled: busy || moving, onClick: onDelete }}
      sync={
        canSyncConfig(machine, imageVersion)
          ? { label: card.syncConfig, disabled: busy || moving, onClick: onSyncConfig }
          : null
      }
    />
  );
}
