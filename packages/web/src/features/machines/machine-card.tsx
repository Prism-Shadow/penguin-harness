/**
 * A machine's card on the Machines page, in the Agents list's shape: one band of "info | the
 * job's stepper | verbs".
 *
 * The info column says which machine this is and how it stands: the alias, with the state as one
 * mark whose word is its tooltip, and the build it carries; the server root; and how this server
 * reaches it, the port its server answers on, and when it was last checked. Its title line is the
 * card's main button and opens the Machine dialog; a click anywhere else on the body opens it too
 * (lib/card-open.ts), while the verbs on the card act on their own.
 *
 * The middle holds the pipeline's stepper while a job for the machine is queued or running and is
 * empty otherwise, so the verbs keep their place when one starts. The verbs: one primary verb —
 * Enable when the machine needs bringing up, Update in its place when it carries another build —
 * and the gear that configures its ssh host. Disable lives in the dialog: beside Enable it would
 * read as a toggle contradicting itself. This server's own card has none: it is where the page is
 * served from.
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
  UpdatePill,
} from "@prismshadow/penguin-ui";
import type { ToneName } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { OPENS_DETAIL_CLASS, cardBodyClick } from "../../lib/card-open";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { toneDot, toneInk } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { MACHINE_PHASES, outOfDate, readMachine, readingTone, wantsUse } from "./machines-view";
import type { MachineReading } from "./machines-view";

/** The reason a machine's state gives beside its word, when it has one: the far side's own words. */
export function reasonText(reading: MachineReading): string | null {
  switch (reading.kind) {
    case "failed":
      return `${S.machines.failedAt(reading.step)} ${reading.message}`;
    case "unreachable":
      return reading.detail;
    case "working":
      return reading.step;
    default:
      return null;
  }
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
      reading.kind === "failed"
        ? ICONS.xCircle
        : reading.kind === "unreachable"
          ? ICONS.alertCircle
          : null,
  };
}

/** The app's tones in the shared package's names, for its `Dot`: a busy dot takes the success fill. */
const DOT_TONE: Record<Tone, ToneName> = {
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
 * The pipeline's six steps as segments, with a caption under them: what a queued or running job
 * is doing, or where a finished one ended — the step that failed in the danger fill.
 */
export function Stepper({ job, className = "" }: { job: MachineJob; className?: string }) {
  const step = job.phase === null ? -1 : MACHINE_PHASES.indexOf(job.phase);
  const result = job.result;
  const failed = !job.queued && !job.running && result !== null && !result.ok;
  const caption = job.queued
    ? S.machines.queued
    : job.running
      ? step >= 0
        ? S.machines.phase[MACHINE_PHASES[step]!]
        : S.machines.working
      : result !== null && !result.ok
        ? S.machines.failedAt(result.step)
        : S.machines.detail.jobDone;
  const fill = (index: number): string => {
    if (job.queued || index > step) return "bg-gray-200 dark:bg-gray-700";
    if (index < step) return toneDot.busy;
    if (failed) return toneDot.danger;
    return job.running ? `${toneDot.busy} ui-live animate-pulse` : toneDot.success;
  };
  return (
    <div className={className}>
      <div className="flex gap-px" aria-hidden="true">
        {MACHINE_PHASES.map((phase, index) => (
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
  /** A request from this page is in flight: the verbs wait for it. */
  busy: boolean;
  /** Opens the Machine dialog. */
  onOpen: () => void;
  /** Brings the machine up, or onto this server's build: the whole pipeline. */
  onUse: () => void;
  onConfigure: () => void;
}

/** One stat on the card's third line: a glyph and a value, its meaning on hover. */
function Stat({ glyph, tooltip, children }: { glyph: string; tooltip: string; children: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`} data-tooltip={tooltip}>
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
      {children}
    </span>
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
}: MachineCardProps) {
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const mark = machineMark(reading);
  const moving = !machine.local && jobMoving(job);
  // Another build than this server's: the pill says so, and Update takes Enable's place. Neither
  // while a job is already on its way.
  const behind = !moving && outOfDate(machine, imageVersion);
  const status = machine.status;
  const port = status?.state === "running" ? (status.port ?? null) : null;
  return (
    <Card
      padding="md"
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${OPENS_DETAIL_CLASS}`}
      onClick={cardBodyClick(onOpen)}
    >
      <div className="min-w-[14rem] flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onOpen}
            className="flex min-w-0 items-center gap-2 rounded-sm text-left"
          >
            <GlyphIcon
              d={ICONS.server}
              size={ICON_SIZE.navRow}
              className="shrink-0 text-gray-500 dark:text-gray-400"
            />
            <span
              className="min-w-0 truncate text-base font-bold"
              // The machine's own id is a detail you go looking for: on hover here, in full in the dialog.
              {...(machine.machineId === null
                ? {}
                : { "data-tooltip": `${S.machines.detailMachineId} ${machine.machineId}` })}
            >
              {machine.alias}
            </span>
            {machine.local && (
              <Badge variant="outline" size="sm">
                {S.machines.localTitle}
              </Badge>
            )}
            <MachineStateMark mark={mark} />
            {machine.installed !== null && <Badge>v{machine.installed.version}</Badge>}
          </button>
          {behind && <UpdatePill onClick={onOpen}>{S.machines.card.updateNeeded}</UpdatePill>}
        </div>
        <p className="mt-1.5 min-h-4 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
          {machine.root}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {machine.local ? (
            <Stat glyph={ICONS.house} tooltip={S.machines.card.localTitle}>
              {S.machines.card.local}
            </Stat>
          ) : (
            <Stat glyph={ICONS.terminalPrompt} tooltip={S.machines.card.sshTitle(machine.alias)}>
              {S.machines.card.ssh}
            </Stat>
          )}
          {port !== null && (
            <Stat glyph={ICONS.network} tooltip={S.machines.card.port(port)}>
              {String(port)}
            </Stat>
          )}
          {status !== null && (
            <Stat
              glyph={ICONS.clock}
              tooltip={S.machines.card.checked(formatDateTime(status.checkedAt))}
            >
              {formatRelativeShort(status.checkedAt, locale)}
            </Stat>
          )}
        </div>
      </div>

      {/* The stepper's slot: empty while nothing moves, and hidden on a narrow screen then, so an
          idle card does not spend a line on it. */}
      <div className={moving ? "w-44 shrink-0" : "hidden w-44 shrink-0 md:block"}>
        {moving && job !== null && <Stepper job={job} />}
      </div>

      {!machine.local && (
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
          <Button
            size="icon"
            title={S.machines.host.configure}
            aria-label={S.machines.host.configure}
            disabled={busy}
            onClick={onConfigure}
          >
            <GlyphIcon
              d={ICONS.gear}
              size={ICON_SIZE.iconButton}
              className="text-gray-600 dark:text-gray-300"
            />
          </Button>
        </div>
      )}
    </Card>
  );
}
