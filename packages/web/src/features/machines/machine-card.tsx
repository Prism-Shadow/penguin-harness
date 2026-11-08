/**
 * A machine's card on the Machines page, in the Agents list's shape: one band of "info | middle |
 * quick buttons".
 *
 * The info column says which machine this is and how it stands: the alias, with the state as one
 * mark whose word is its tooltip, and the build it carries; the server root; and how this server
 * reaches it, the port its server answers on, and when it was last checked. Its title line is the
 * card's main button and opens the Machine dialog; a click anywhere else on the body opens it too
 * (lib/card-open.ts), while the buttons on the card act on their own.
 *
 * Only a mark without words carries a hint — the state mark, the delete icon: the tooltip layer
 * opens none on text already on screen. What a stat means, and the machine's own id, the dialog
 * says.
 *
 * The middle holds the job's stepper while a job for the machine is queued or running; while
 * none is, and Use cannot start a conversation there, it says why in one muted line (a hint would
 * never open on the button, which shows its word). The quick buttons are the Agents card's: Use
 * starts a new conversation in the machine's temporary workspace, Settings opens the Machine
 * dialog, Delete takes the machine off this Project after a confirmation. Before them, while the
 * machine is connected on this server's build, an icon button syncs this Project's config to it
 * now; it stands first so that the buttons after it line up across cards whether or not it is
 * there. This server's own card keeps Use and Settings; its Delete is a placeholder that cannot
 * be pressed.
 */
import type { MachineInfo, MachineJob } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Card,
  Dot,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  RetryStatus,
  UpdatePill,
} from "@prismshadow/penguin-ui";
import type { RetryStatusProps, ToneName } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { cardBodyClick } from "../../lib/card-open";
import { formatRelativeShort } from "../../lib/format";
import { toneDot, toneInk } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import {
  canSyncConfig,
  isPhase,
  outOfDate,
  readMachine,
  readingTone,
  stepLabel,
  useWaitsBecause,
  wantsUse,
  type MachineReading,
  type RetryReading,
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
 * The shared retry row for a machine's retry reading: its sentence and countdown in the reader's
 * words, and the presses on offer — "Retry now" and "Stop retrying" while the streak runs, "Retry"
 * after it stopped. `reason` replaces the reading's own (the dialog says the last failure in full
 * under the row, so its row says none).
 */
export function retryStatus(
  view: RetryReading,
  {
    onRetry,
    onStop,
    held,
    size = "xs",
    reason = view.reason,
  }: {
    /** Retries now; a promise that rejects says the server refused, so the press can be made again. */
    onRetry: () => unknown;
    /** Stops retrying; a promise that rejects lets the press be made again. */
    onStop: () => unknown;
    /** Something else is in flight or moving on the machine: the presses are not taken. */
    held: boolean;
    size?: "xs" | "sm";
    reason?: string | null;
  },
): RetryStatusProps {
  const r = S.machines.retry;
  const { offers } = view;
  return {
    phase: view.phase,
    label: view.label,
    ...(view.countdown === null ? {} : { countdown: view.countdown }),
    reason,
    nextAt: view.nextAtMs,
    retry:
      offers.retryNow || offers.retry
        ? { label: offers.retryNow ? r.retryNow : r.retry, onClick: onRetry, disabled: held }
        : null,
    secondary: offers.stop ? { label: r.stop, onClick: onStop, disabled: held } : null,
    size,
  };
}

/** What a machine's state mark shows: its words, its tone, and its shape. */
export interface MachineMark {
  /** The state's word, with the reason beside it when there is one — the tooltip and the name. */
  label: string;
  tone: Tone;
  /** A job is queued or running for it: the dot pulses. */
  moving: boolean;
  /**
   * The glyph of a machine that is not working — a cross for a failed job (danger), an alert for
   * a machine out of reach (attention: waiting on its network, not failed) — so the two read
   * apart by shape as well as ink; null for the dot every other state wears.
   */
  glyph: string | null;
}

/** A machine's mark; `reading` is null for this server's own entry, which is simply serving. */
export function machineMark(reading: MachineReading | null): MachineMark {
  if (reading === null) {
    return { label: S.machines.state.serving, tone: "link", moving: false, glyph: null };
  }
  const word = S.machines.state[reading.kind];
  const reason = reasonText(reading);
  return {
    // A failure's reason already begins by saying it failed.
    label: reason === null ? word : reading.kind === "failed" ? reason : `${word} · ${reason}`,
    tone: readingTone(reading),
    moving: reading.kind === "queued" || reading.kind === "working",
    glyph:
      reading.kind === "failed" || reading.kind === "signInRefused"
        ? ICONS.xCircle
        : reading.kind === "unreachable"
          ? ICONS.alertCircle
          : null,
  };
}

/**
 * The app's tones in the shared package's names, for its `Dot` and `Badge`: a busy dot takes the
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

/**
 * A machine's state as one mark beside its name: a dot in the state's tone — the shared `Dot`,
 * which owns the pulse of a moving machine — or a glyph for a failed or unreachable machine. The
 * words are the tooltip and the accessible name, never a line of coloured text.
 */
export function MachineStateMark({ mark }: { mark: MachineMark }) {
  return (
    <span
      role="img"
      aria-label={mark.label}
      data-tooltip={mark.label}
      data-tooltip-content="text"
      className={`inline-flex size-4 shrink-0 items-center justify-center ${mark.glyph === null ? "" : toneInk[mark.tone]}`}
    >
      {mark.glyph === null ? (
        <Dot tone={DOT_TONE[mark.tone]} pulse={mark.moving} />
      ) : (
        <GlyphIcon d={mark.glyph} size={ICON_SIZE.inlineGlyph} />
      )}
    </span>
  );
}

/** A job is still to come or under way. */
export const jobMoving = (job: MachineJob | null): boolean =>
  job !== null && (job.queued || job.running);

/**
 * The job's own steps as segments, with a caption under them: what a queued or running job is
 * doing, or where a finished one ended — the step that failed in the danger fill.
 */
export function Stepper({ job, className = "" }: { job: MachineJob; className?: string }) {
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
  const fill = (index: number): string => {
    if (job.queued || index > step) return "bg-gray-200 dark:bg-gray-700";
    if (index < step) return toneDot.busy;
    if (failed) return toneDot.danger;
    return job.running ? `${toneDot.busy} ui-live animate-pulse` : toneDot.success;
  };
  return (
    <div className={className}>
      <div className="flex gap-px" aria-hidden="true">
        {job.steps.map((phase, index) => (
          <span
            key={phase}
            // The segment being worked on pulses as a live signal, so a theme can re-time it.
            data-live={job.running && index === step ? "dot" : undefined}
            className={`h-[3px] flex-1 rounded-sm ${fill(index)}`}
          />
        ))}
      </div>
      <div
        className={`mt-1 truncate text-xs ${job.running ? toneInk.busy : "text-gray-500 dark:text-gray-400"}`}
      >
        {caption}
      </div>
    </div>
  );
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
  /** Brings the machine up, or onto this server's build: the whole pipeline. */
  onUse: () => void;
  kindTitle?: string;
  onConfigure: (() => void) | null;
  /** Hands the machine this Project's config now (a job). */
  onSyncConfig: () => void;
  /** Opens this machine's Ports page when it has an addressable id. */
  onPorts?: (() => void) | null;
}

/** One stat on the card's third line: a glyph and a value. The dialog says what each one means. */
function Stat({ glyph, children }: { glyph: string; children: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`}>
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
      {children}
    </span>
  );
}

/**
 * Why Use waits, in the card's middle: a muted line with a mark that says the line is a reason —
 * decorative, so a theme may drop it and the words still say it all.
 */
function UseWaits({ why }: { why: string }) {
  return (
    <p
      data-use-waits=""
      className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400"
    >
      <GlyphIcon
        d={ICONS.info}
        size={ICON_SIZE.inlineGlyph}
        className="ui-icon-decor mt-0.5 shrink-0"
      />
      <span>{why}</span>
    </p>
  );
}

export function MachineCard({
  machine,
  job,
  imageVersion,
  locale,
  busy,
  onOpen,
  onUse,
  onConfigure,
  kindTitle = machine.kind,
  onSyncConfig,
  onPorts = null,
}: MachineCardProps) {
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const mark: MachineMark =
    machine.unavailable === undefined
      ? machineMark(reading)
      : {
          label: `${S.machines.kindUnavailable} · ${kindTitle}: ${machine.unavailable}`,
          tone: "attention",
          moving: false,
          glyph: ICONS.alertCircle,
        };
  const moving = !machine.local && jobMoving(job);
  // Another build than this server's: the pill says so and opens the dialog, where the update is.
  // Not while a job is already on its way.
  const behind = !moving && outOfDate(machine, imageVersion);
  const status = machine.status;
  const port = status?.state === "running" ? (status.port ?? null) : null;
  const waits = useWaitsBecause(machine, job, reading, locale, Date.now());
  const card = S.machines.card;
  return (
    <Card
      padding="md"
      data-machine={machine.id}
      interactive
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
      onClick={cardBodyClick(onOpen)}
    >
      <div className="min-w-[14rem] flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {/* Wraps rather than squeezes: on a phone the badges go under the name, which would
              otherwise be truncated to its first letter beside a long version. The glyph stays
              with the name. */}
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onOpen}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <GlyphIcon
                d={ICONS.server}
                size={ICON_SIZE.navRow}
                className="shrink-0 text-gray-500 dark:text-gray-400"
              />
              <span className="min-w-0 truncate text-base font-bold">{machine.alias}</span>
            </span>
            {machine.local && (
              <Badge variant="outline" size="sm">
                {S.machines.localTitle}
              </Badge>
            )}
            <MachineStateMark mark={mark} />
            {machine.installed !== null && <Badge>v{machine.installed.version}</Badge>}
          </button>
          {behind && <UpdatePill onClick={onOpen}>{card.updateNeeded}</UpdatePill>}
        </div>
        <p className="mt-1.5 min-h-4 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
          {machine.root}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {machine.local ? (
            <Stat glyph={ICONS.house}>{card.local}</Stat>
          ) : (
            <Stat glyph={ICONS.terminalPrompt}>{card.ssh}</Stat>
          )}
          {port !== null && <Stat glyph={ICONS.network}>{String(port)}</Stat>}
          {status !== null && (
            <Stat glyph={ICONS.clock}>{formatRelativeShort(status.checkedAt, locale)}</Stat>
          )}
        </div>
      </div>

      {/* The middle: the job's stepper while one moves, else why Use waits — and on a narrow
          screen nothing, taking no line, when there is neither. */}
      <div className={moving || waits !== null ? "w-44 shrink-0" : "hidden w-44 shrink-0 md:block"}>
        {moving && job !== null ? (
          <Stepper job={job} />
        ) : (
          waits !== null && <UseWaits why={waits} />
        )}
      </div>

      {!machine.local && machine.unavailable === undefined && (
        <div className="flex shrink-0 items-center gap-2">
          {behind ? (
            <Button size="sm" variant="primary" disabled={busy} onClick={onUse}>
              <GlyphIcon d={ICONS.refresh} />
              {S.machines.card.update}
            </Button>
          ) : (
            reading !== null &&
            wantsUse(reading) && (
              <Button size="sm" variant="primary" disabled={busy} onClick={onUse}>
                <GlyphIcon d={ICONS.plug} />
                {S.machines.use}
              </Button>
            )
          )}
          {canSyncConfig(machine, imageVersion) && (
            <Button
              size="icon"
              data-action="sync-config"
              title={card.syncConfig}
              aria-label={card.syncConfig}
              disabled={busy || moving}
              onClick={onSyncConfig}
            >
              <GlyphIcon d={ICONS.upload} size={ICON_SIZE.iconButton} />
            </Button>
          )}
          {onConfigure !== null && (
            <Button
              size="icon"
              title={S.machines.definition.configure}
              aria-label={S.machines.definition.configure}
              disabled={busy}
              onClick={onConfigure}
            >
              <GlyphIcon
                d={ICONS.gear}
                size={ICON_SIZE.iconButton}
                className="text-gray-600 dark:text-gray-300"
              />
            </Button>
          )}
          {onPorts !== null && (
            <Button size="sm" variant="secondary" title={S.ports.verbTitle} onClick={onPorts}>
              <GlyphIcon d={ICONS.arrowsOpposed} size={ICON_SIZE.inlineGlyph} />
              {S.ports.verb}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
