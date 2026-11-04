/**
 * The Machine dialog: everything about one machine that its card leaves out, and every verb it
 * takes, in four blocks under the alias.
 *
 * - The header: a tile, the state as one chip — a glyph (a spinner while a job runs) and one plain
 *   word, the reason behind it on the glyph's hover — the installed version, and one line saying
 *   how this server reaches the machine.
 * - Details: the facts, each label led by its glyph — how the machine is reached, the address its
 *   ssh alias names, the data directory; the server over there (with ssh's own words under it
 *   when it is out of reach), the last check (how long ago, and the time itself), the build it
 *   carries — and last, quiet, the machine's own id with a copy button.
 * - Progress, while a job is queued or running and after one: its steps one per line, each marked
 *   done, current, failed or still to come; a job that finished well is a single quiet line. The
 *   log is folded underneath, open while the job runs. A failed job says at which step and in the
 *   far side's own words, with Retry — and Force install when the failure offers it — listed under
 *   it, each with what it does.
 * - Actions: the one thing to do next, with what it does beside it; then the single steps and the
 *   ways out, two groups under small ruled captions, each verb on a line of its own: its button,
 *   and beside it what it does. A verb that cannot run now stays in place, disabled, and says why
 *   instead.
 *
 * The one thing to do has exactly one home: under the failure when the last job failed, else the
 * first row of Actions. This server's own entry has the header and Details alone: it runs no jobs
 * and takes no verbs.
 *
 * No hint sits on words already on screen: the tooltip layer opens one only on an element that
 * shows no text of its own, so there it would never open. The hints here sit on marks without
 * words — the chip's glyph and the id's copy button — and everything else is said in text.
 *
 * `MachineDetailBody` is a pure function of its props. The dialog around it adds one read, the
 * host block, which the machines list does not carry: the list is the ssh config's aliases only.
 */
import { Fragment, useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import type {
  MachineInfo,
  MachineJob,
  MachineDefinitionResponse,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Chevron,
  CopyButton,
  Dot,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  KeyValue,
  KeyValueRow,
  LogView,
  Modal,
  NoticeStrip,
  RuledSection,
  Spinner,
} from "@prismshadow/penguin-ui";
import type { ButtonVariant } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { DOT_TONE, jobMoving } from "./machine-card";
import {
  configSyncView,
  holdReason,
  jobView,
  machineChip,
  machineFacts,
  primaryAction,
  reconnectView,
  verbGroups,
  verbHold,
} from "./machine-detail-view";
import type {
  CheckLine,
  ConfigSyncView,
  Fact,
  JobStep,
  MachineChip,
  StepState,
  VerbContext,
  VerbGroup,
} from "./machine-detail-view";
import { outOfDate, readMachine, socketReading } from "./machines-view";

/** Everything the dialog can ask its page to do for the machine. */
export type MachineVerb =
  | "use"
  | "stopUsing"
  | "replaceProgram"
  | "install"
  | "connect"
  | "restart"
  | "disconnect"
  | "release"
  | "configure";

export interface MachineDetailBodyProps {
  machine: MachineInfo;
  /** The machine's job: queued, running, or its last finished one. */
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  /** The host block the alias names; null until read, or when the config has none this app can read. */
  host: MachineDefinitionResponse | null;
  /** The page's last error, repeated here because the dialog covers the notice that says it. */
  error: string | null;
  /** A request from this page is in flight: every verb waits for it. */
  busy: boolean;
  /** This server has no build to push, so an install has nothing to send. */
  noImage: boolean;
  canConfigure?: boolean;
  /** The clock the reconnecting streak and the last check are measured from. */
  now?: number;
  onAct: (verb: MachineVerb) => void;
}

/** The header tile's box and glyph, in px: the plugin dialog's header tile, so the two match. */
const TILE_PX = 40;
const TILE_GLYPH_PX = 22;

/** The header's tile: the server glyph on a muted square. Decorative — the title names the machine. */
function MachineTile() {
  return (
    <span
      aria-hidden="true"
      style={{ width: TILE_PX, height: TILE_PX }}
      className="flex shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted"
    >
      <GlyphIcon d={ICONS.server} size={TILE_GLYPH_PX} />
    </span>
  );
}

/**
 * The state as one chip in its tone: the glyph — a spinner for a working machine — then the word.
 * The glyph is information, not decoration: it is the shape that tells apart two states sharing a
 * tone. The reason rides on the glyph, which shows no text of its own: the tooltip layer shows a
 * hint only where its words are not already on screen, so on the word it would never open.
 */
function StatusChip({ chip }: { chip: MachineChip }) {
  return (
    <Badge variant="soft" tone={DOT_TONE[chip.tone]}>
      <span
        className="inline-flex"
        {...(chip.reason === null
          ? {}
          : { "data-tooltip": chip.reason, "data-tooltip-content": "text" })}
      >
        {chip.glyph === null ? (
          <Spinner size="xs" tone="success" label={chip.word} />
        ) : (
          <GlyphIcon d={chip.glyph} size={ICON_SIZE.inlineGlyph} className={toneInk[chip.tone]} />
        )}
      </span>
      <span className="ml-1">{chip.word}</span>
    </Badge>
  );
}

/**
 * The width every fact label takes, per language: the longest label there, with its glyph. Each
 * list sizes its own label column, so a shared floor is what lines the lists up — the two columns
 * when a phone stacks them, and the id row under the first column.
 */
const FACT_LABEL_WIDTH: Record<"zh" | "en", string> = {
  zh: "min-w-[6em]",
  en: "min-w-[8em]",
};

/**
 * A fact's label: a glyph that says what the words say — decorative, so a theme may drop it and
 * the label still reads — then the words.
 */
function FactLabel({ icon, label, width }: { icon: string; label: string; width: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${width}`}>
      <GlyphIcon d={icon} size={ICON_SIZE.inlineGlyph} className="ui-icon-decor text-fg-subtle" />
      {label}
    </span>
  );
}

/**
 * A path with a break opportunity after each separator, so one too long for its column wraps at a
 * directory rather than inside a name.
 */
function breakAtSeparators(path: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let start = 0;
  for (let at = 0; at < path.length; at++) {
    if (path[at] !== "/" && path[at] !== "\\") continue;
    parts.push(path.slice(start, at + 1), <wbr key={at} />);
    start = at + 1;
  }
  parts.push(path.slice(start));
  return parts;
}

/**
 * A value and its aside after a separator: on one line where the two fit, the aside on a line of
 * its own where they do not — and then without the separator, which never starts a line. The
 * aside is pulled back over the room its separator takes and the row clips at its own edge, so a
 * separator that would start a line falls outside it; on a shared line the value's margin gives
 * that room back.
 */
function WithAside({ value, aside }: { value: ReactNode; aside: string }) {
  return (
    <span className="flex flex-wrap overflow-hidden">
      <span className="mr-[1.25em]">{value}</span>
      <span className="-ml-[1.25em] whitespace-nowrap text-fg-muted">
        <span aria-hidden="true" className="inline-block w-[1.25em] text-center">
          ·
        </span>
        {aside}
      </span>
    </span>
  );
}

/**
 * One fact: the label muted, the value semibold — the part that is read — or muted when quiet;
 * `after` stands beside the value (the id's copy button). What stands behind the value is said in
 * the muted ink: the aside after it, and the note on a line of its own under it, its own line
 * breaks kept.
 */
function FactRow({
  fact,
  labelWidth,
  after,
}: {
  fact: Fact;
  labelWidth: string;
  after?: ReactNode;
}) {
  const value = (
    <span className={fact.quiet ? "text-fg-muted" : "font-semibold"}>
      {fact.key === "root" ? breakAtSeparators(fact.value) : fact.value}
    </span>
  );
  return (
    <KeyValueRow
      label={<FactLabel icon={fact.icon} label={fact.label} width={labelWidth} />}
      mono={fact.mono}
    >
      {after !== undefined ? (
        <span className="inline-flex items-center gap-1.5">
          {value}
          {after}
        </span>
      ) : fact.aside !== undefined ? (
        <WithAside value={value} aside={fact.aside} />
      ) : (
        value
      )}
      {fact.note !== undefined && (
        <span className="block whitespace-pre-line text-fg-muted">{fact.note}</span>
      )}
    </KeyValueRow>
  );
}

/** Each step's mark, drawn in a box of one size so the names line up whatever the mark. */
function StepMark({ step }: { step: JobStep }) {
  switch (step.state) {
    case "done":
      return <GlyphIcon d={ICONS.check} size={ICON_SIZE.rowLead} className="text-fg-subtle" />;
    case "current":
      return <Spinner size="sm" tone="success" label={step.name} />;
    case "failed":
      return <GlyphIcon d={ICONS.xCircle} size={ICON_SIZE.rowLead} className={toneInk.danger} />;
    case "pending":
      return <Dot tone="neutral" />;
  }
}

/** The step's name in its ink: a failed step's words stay in the body ink — only its mark is red. */
const STEP_INK: Record<StepState, string> = {
  done: "text-fg-muted",
  current: "text-fg",
  failed: "text-fg",
  pending: "text-fg-subtle",
};

/** The job's steps, one per line, each marked by where the job stands. */
export function JobSteps({ steps }: { steps: readonly JobStep[] }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {steps.map((step) => (
        <li
          key={step.phase}
          data-step={step.phase}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex items-center gap-2"
        >
          <span
            style={{ width: ICON_SIZE.rowLead, height: ICON_SIZE.rowLead }}
            className="inline-flex shrink-0 items-center justify-center"
          >
            <StepMark step={step} />
          </span>
          <span className={STEP_INK[step.state]}>{step.name}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The job's log behind a fold: a row naming itself with the app's collapse chevron, over a panel
 * that stays in the DOM and is `hidden` while closed (the WAI-ARIA disclosure pattern). Open from
 * the start while the job runs; closed or opened, it stays so while the dialog is open.
 */
export function LogFold({ job }: { job: MachineJob }) {
  const [open, setOpen] = useState(() => job.running);
  const panelId = useId();
  return (
    <div className="mt-3 border-t border-line pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className={`flex items-center ${ICON_GAP.tight} rounded-sm text-xs font-semibold text-fg-muted transition-colors duration-150 hover:text-fg`}
      >
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        {S.machines.detail.showLog}
      </button>
      <div id={panelId} hidden={!open} className="pt-3">
        <LogView
          lines={job.log}
          highlightLast={job.running}
          maxHeight="sm"
          label={S.machines.detail.logLabel}
        />
      </div>
    </div>
  );
}

/**
 * One verb's button: its glyph before its word, `data-verb` naming the verb for whatever reads
 * the markup. No hint rides on it — the tooltip layer would never open one on a button that shows
 * its word — so what it does, or why it waits, stands beside it as text.
 */
function CheckRow({ line }: { line: CheckLine }) {
  return (
    <li data-check={line.id} data-state={line.state} className="flex items-start gap-2">
      <span
        style={{ width: ICON_SIZE.rowLead, height: ICON_SIZE.rowLead }}
        className="mt-0.5 inline-flex shrink-0 items-center justify-center"
      >
        {line.glyph === null ? (
          <Dot tone="neutral" />
        ) : (
          <GlyphIcon d={line.glyph} size={ICON_SIZE.rowLead} className={toneInk[line.tone]} />
        )}
      </span>
      <span className="min-w-0">
        <span className={line.state === "skip" ? "text-fg-subtle" : "text-fg"}>{line.text}</span>
        {line.detail !== null && (
          <span className="mt-0.5 block break-words whitespace-pre-line text-xs text-fg-muted">
            {line.detail}
          </span>
        )}
      </span>
    </li>
  );
}

/** The check lines as a list: each line's mark and sentence, ssh's own words under a sign-in that failed. */
function CheckList({ lines, alias }: { lines: readonly CheckLine[]; alias: string }) {
  return (
    <ul className="space-y-2 text-sm" data-diagnosis={alias}>
      {lines.map((line) => (
        <CheckRow key={line.id} line={line} />
      ))}
    </ul>
  );
}

/**
 * The last config sync: one quiet line — a check, or the danger cross on a failure, beside the
 * words — and, when the sync left anything behind, one attention notice saying what and why.
 */
function ConfigSync({ view }: { view: ConfigSyncView }) {
  const c = S.machines.detail.configSync;
  return (
    <>
      <p
        data-config-sync={view.ok ? "ok" : "failed"}
        className="mt-1.5 flex items-start gap-1.5 text-xs text-fg-muted"
      >
        <GlyphIcon
          d={view.ok ? ICONS.check : ICONS.xCircle}
          size={ICON_SIZE.inlineGlyph}
          className={`mt-0.5 shrink-0 ${view.ok ? "text-fg-subtle" : toneInk.danger}`}
        />
        <span className="min-w-0 break-words whitespace-pre-line">{view.line}</span>
      </p>
      {(view.envOnly || view.skipped.length > 0) && (
        <NoticeStrip
          tone="attention"
          data-config-sync-notice=""
          className="mt-3 space-y-2 rounded-md border px-3 py-2 text-sm"
        >
          {view.envOnly && <p data-env-only="">{c.envOnly}</p>}
          {view.skipped.length > 0 && (
            <div data-skipped="">
              <p>{c.skippedTitle}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 break-words">
                {view.skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </NoticeStrip>
      )}
    </>
  );
}

function Verb({
  verb,
  glyph,
  label,
  held,
  variant = "ghost",
  onClick,
}: {
  verb: MachineVerb;
  glyph: string;
  label: string;
  /** The verb cannot run now. */
  held: boolean;
  variant?: ButtonVariant;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant={variant} disabled={held} onClick={onClick} data-verb={verb}>
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
      {label}
    </Button>
  );
}

/** A group's caption: its name, then a hairline to the end of the row — a ruled section in small. */
function GroupCaption({ caption, first }: { caption: string; first: boolean }) {
  return (
    <h4
      className={`flex items-center gap-3 justify-self-stretch text-xs text-fg-muted sm:col-span-2 ${first ? "" : "mt-3"}`}
    >
      {caption}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </h4>
  );
}

/**
 * A list of verbs, one per line: every button in a first column as wide as the widest of them,
 * so every line beside them starts at one edge in either language; one column on a phone.
 */
function VerbGrid({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`grid justify-items-start gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-x-4 sm:gap-y-1.5 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * One verb of a list: its button, and beside it what the verb does — or, while something of the
 * machine's holds it, why, after a mark that says the line is a reason. In the muted ink either
 * way: a held verb is waiting, not failing. On a phone the line sits under its button, indented by
 * the button's own padding so it starts under the glyph; from `sm` the pair joins the list's grid.
 */
function VerbItem({
  verb,
  glyph,
  label,
  why,
  reason = null,
  held,
  variant,
  onClick,
}: {
  verb: MachineVerb;
  glyph: string;
  label: string;
  /** What the verb does. */
  why: string;
  /** Why the verb waits on the machine; null when nothing of the machine's holds it. */
  reason?: string | null;
  held: boolean;
  variant?: ButtonVariant;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1 sm:contents">
      <Verb
        verb={verb}
        glyph={glyph}
        label={label}
        held={held}
        variant={variant}
        onClick={onClick}
      />
      <p className="flex items-start gap-1.5 pl-2.5 text-sm text-fg-muted sm:pl-0">
        {reason !== null && (
          <GlyphIcon
            d={ICONS.info}
            size={ICON_SIZE.inlineGlyph}
            className="ui-icon-decor mt-1 text-fg-subtle"
          />
        )}
        <span>{reason ?? why}</span>
      </p>
    </div>
  );
}

/**
 * Actions' groups as one list, each group under its caption and each verb on a line of its own;
 * one grid holds both groups. A request in flight holds every verb without rewriting a line: it
 * lasts a moment, and every row would flicker.
 */
function VerbList({
  groups,
  ctx,
  onAct,
}: {
  groups: readonly VerbGroup[];
  ctx: VerbContext;
  onAct: (verb: MachineVerb) => void;
}) {
  const hold = S.machines.detail.hold;
  return (
    <VerbGrid>
      {groups.map((group, index) => (
        <Fragment key={group.caption}>
          <GroupCaption caption={group.caption} first={index === 0} />
          {group.rows.map((row) => {
            const reason = holdReason(row.verb, ctx);
            return (
              <VerbItem
                key={row.verb}
                verb={row.verb}
                glyph={row.glyph}
                label={row.label}
                why={row.why}
                reason={reason === null ? null : hold[reason]}
                held={verbHold(row.verb, ctx) !== null}
                onClick={() => onAct(row.verb)}
              />
            );
          })}
        </Fragment>
      ))}
    </VerbGrid>
  );
}

export function MachineDetailBody({
  machine,
  job,
  imageVersion,
  locale,
  host,
  error,
  busy,
  noImage,
  canConfigure = true,
  now = Date.now(),
  onAct,
}: MachineDetailBodyProps) {
  const m = S.machines;
  const d = m.detail;
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const behind = outOfDate(machine, imageVersion);
  const chip = machineChip(reading, imageVersion);
  const facts = machineFacts(machine, host, imageVersion, locale, now);
  const view = !machine.local && job !== null ? jobView(job) : null;
  const primary =
    reading === null || machine.unavailable !== undefined
      ? null
      : primaryAction(reading, behind, imageVersion);
  const reconnect = machine.local ? null : reconnectView(machine, locale, now);
  const configSync = machine.local ? null : configSyncView(machine, locale, now);
  const labelWidth = FACT_LABEL_WIDTH[locale];
  const ctx: VerbContext = {
    busy,
    moving: jobMoving(job),
    noImage,
    connected: machine.connection !== null,
    unreachable: machine.status?.state === "unreachable",
  };
  return (
    <div className="space-y-6">
      {error !== null && (
        <NoticeStrip tone="danger" className="rounded-md border px-3 py-2 text-sm">
          {error}
        </NoticeStrip>
      )}

      {machine.unavailable !== undefined && (
        <NoticeStrip tone="attention">{machine.unavailable}</NoticeStrip>
      )}
      <div className="flex items-start gap-3">
        <MachineTile />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip chip={chip} />
            {/* The version on offer is Details' to say, beside the installed one. */}
            {machine.installed !== null && (
              <Badge variant="soft" tone={behind ? "attention" : "neutral"}>
                v{machine.installed.version}
              </Badge>
            )}
            {machine.local && <Badge variant="outline">{m.localTitle}</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {machine.local ? d.describeLocal : d.describeRemote(machine.alias)}
          </p>
        </div>
      </div>

      <RuledSection level={3} title={d.facts}>
        {/* Two columns from sm up — where the machine is, and how it stands — the first wider,
            since paths live there, the second wide enough that a port or a version note stays
            on one line. One column on a phone. */}
        <div className="grid items-start gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <KeyValue size="sm">
            {facts.left.map((fact) => (
              <FactRow key={fact.key} fact={fact} labelWidth={labelWidth} />
            ))}
          </KeyValue>
          <KeyValue size="sm">
            {facts.right.map((fact) => (
              <FactRow key={fact.key} fact={fact} labelWidth={labelWidth} />
            ))}
          </KeyValue>
        </div>
        {/* The machine's own id is a detail you go looking for: it closes the section, quiet,
            with its copy button. */}
        <MachineSocketDetails machine={machine} locale={locale} />

        {facts.id !== null && (
          <KeyValue size="sm" className="mt-2">
            <FactRow
              fact={facts.id}
              labelWidth={labelWidth}
              after={<CopyButton size="sm" text={facts.id.value} label={d.copyMachineId} />}
            />
          </KeyValue>
        )}
      </RuledSection>

      {configSync !== null && <ConfigSync view={configSync} />}

      {reconnect !== null && (
        <RuledSection level={3} title={d.reconnect.title}>
          {/* A refused password stops the retries: the line says so instead of counting down. */}
          {reconnect.stopped ? (
            <p
              data-reconnect="stopped"
              className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
            >
              <GlyphIcon
                d={ICONS.xCircle}
                size={ICON_SIZE.inlineGlyph}
                className={toneInk.danger}
              />
              <span className="font-semibold">{d.reconnect.stopped}</span>
              <span className="text-fg-muted">{d.reconnect.lasting(reconnect.lasting)}</span>
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
              <Spinner size="xs" tone="success" label={d.reconnect.trying} />
              <span className="font-semibold">{d.reconnect.trying}</span>
              <span className="text-fg-muted">
                {[
                  d.reconnect.lasting(reconnect.lasting),
                  d.reconnect.attempt(reconnect.attempt),
                  reconnect.next === null ? d.reconnect.now : d.reconnect.next(reconnect.next),
                ].join(" · ")}
              </span>
            </p>
          )}
          {reconnect.lastError !== null && (
            <p className="mt-2 text-sm break-words whitespace-pre-line">
              <span className="text-fg-muted">{d.reconnect.lastError}</span> {reconnect.lastError}
            </p>
          )}
          {reconnect.detail !== null && (
            <p data-said="ssh" className="mt-1 text-xs break-words text-fg-muted">
              {reconnect.detail}
            </p>
          )}
          {reconnect.check !== null && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-fg-muted">{d.reconnect.checked}</p>
              <CheckList lines={reconnect.check} alias={machine.alias} />
            </div>
          )}
        </RuledSection>
      )}

      {view !== null && job !== null && (
        <RuledSection level={3} title={d.progress}>
          {view.kind === "queued" && (
            <p className="mb-2 flex items-center gap-1.5 text-sm text-fg-muted">
              <GlyphIcon
                d={ICONS.hourglass}
                size={ICON_SIZE.inlineGlyph}
                className={toneInk.attention}
              />
              {m.queued}
            </p>
          )}
          {view.kind !== "done" && <JobSteps steps={view.steps} />}
          {view.kind === "done" && (
            <p className="flex items-center gap-1.5 text-sm text-fg-muted">
              <GlyphIcon d={ICONS.check} size={ICON_SIZE.inlineGlyph} className="text-fg-subtle" />
              {d.lastJobDone}
            </p>
          )}
          {view.kind === "failed" && (
            <p className="mt-3 text-sm">{d.failedAtStep(view.stepName, view.message)}</p>
          )}
          {view.kind === "failed" && view.detail !== null && (
            <p data-said="ssh" className="mt-1 text-xs break-words text-fg-muted">
              {view.detail}
            </p>
          )}
          {/* What the server's own connection check found after the failure: the explanation. */}
          {view.kind === "failed" && view.check !== null && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-fg-muted">{m.check.title}</p>
              {view.check.kind === "running" ? (
                <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                  <Spinner size="xs" tone="success" label={d.checking} />
                  {d.checking}
                </p>
              ) : (
                <CheckList lines={view.check.lines} alias={machine.alias} />
              )}
            </div>
          )}

          {/* A failed machine's one thing to do is here, under what went wrong — and only here —
              listed like the verbs of Actions, each with what it does beside it. */}
          {view.kind === "failed" && primary?.kind === "retry" && (
            <VerbGrid className="mt-3">
              <VerbItem
                verb="use"
                variant="primary"
                glyph={primary.glyph}
                label={primary.label}
                why={primary.why}
                held={busy}
                onClick={() => onAct("use")}
              />
              {view.canReplaceProgram && (
                <VerbItem
                  verb="replaceProgram"
                  // Secondary: the confirmation that follows carries the danger tone.
                  variant="secondary"
                  glyph={ICONS.download}
                  label={m.replaceProgram}
                  why={m.replaceProgramWhy}
                  held={busy}
                  onClick={() => onAct("replaceProgram")}
                />
              )}
            </VerbGrid>
          )}
          {job.log.length > 0 && <LogFold job={job} />}
        </RuledSection>
      )}

      {!machine.local && machine.unavailable === undefined && (
        <RuledSection level={3} title={d.actions}>
          {primary !== null && primary.kind !== "retry" && (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Verb
                verb="use"
                variant="primary"
                glyph={primary.glyph}
                label={primary.label}
                held={busy}
                onClick={() => onAct("use")}
              />
              <span className="text-xs text-fg-muted">{primary.why}</span>
            </div>
          )}
          {/* The single steps answer 409 while a job runs for the machine, so they wait for
              it; letting go of the machine does not. */}
          <VerbList
            groups={verbGroups(primary?.kind ?? null).map((group) => ({
              ...group,
              rows: group.rows.filter((row) => row.verb !== "configure" || canConfigure),
            }))}
            ctx={ctx}
            onAct={onAct}
          />
        </RuledSection>
      )}
    </div>
  );
}

/**
 * The dialog itself: titled with the machine's alias, closed by its header's cross alone, as wide
 * as the model dialogs — Details holds two columns of label and value side by side. `hostEpoch`
 * moves when the page saves the ssh host's form, so Details reads the block again.
 */
export function MachineDetailDialog({
  projectId,
  hostEpoch,
  onClose,
  ...body
}: Omit<MachineDetailBodyProps, "host"> & {
  projectId: string;
  hostEpoch: number;
  onClose: () => void;
}) {
  const { alias, local, kind, unavailable } = body.machine;
  const [host, setHost] = useState<MachineDefinitionResponse | null>(null);
  useEffect(() => {
    setHost(null);
    if (local || unavailable !== undefined || body.canConfigure === false) return;
    let cancelled = false;
    api.getMachineDefinition(projectId, kind, alias).then(
      (found) => {
        if (!cancelled) setHost(found);
      },
      // A block that lives in an included file, or none at all: Details names the alias alone.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, alias, local, kind, unavailable, body.canConfigure, hostEpoch]);
  // The reconnecting streak and the last check are said against the clock, read as each render
  // happens — a stamp the server wrote a moment after the dialog opened is not in the future —
  // and the clock moving on its own redraws it now and then.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Modal open title={alias} onClose={onClose} widthClass="sm:max-w-3xl">
      <MachineDetailBody {...body} host={host} now={Date.now()} />
    </Modal>
  );
}

/** The socket held to this machine, independent of its server/process status. */
export function MachineSocketDetails({
  machine,
  locale,
}: {
  machine: MachineInfo;
  locale: "zh" | "en";
}) {
  const socket = socketReading(machine);
  if (socket === null) return null;
  const ink =
    socket.tone === "attention" || socket.tone === "danger" ? toneInk[socket.tone] : undefined;
  return (
    <KeyValue size="sm" className="mt-2">
      <KeyValueRow label={S.machines.detailSocket}>
        <span className={ink} data-tooltip={formatDateTime(socket.since)}>
          {`${socket.label} · ${formatRelativeShort(socket.since, locale)}`}
          {socket.detail === null ? null : ` · ${socket.detail}`}
        </span>
      </KeyValueRow>
    </KeyValue>
  );
}
