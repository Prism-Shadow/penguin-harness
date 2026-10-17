/**
 * The Machine dialog: everything about one machine that its card leaves out, and every verb it
 * takes.
 *
 * - The header: a tile, the state as one label pill — one plain word in its tone, the reason behind
 *   it on the pill's hover — the installed version and this server's tag in the same pill shape,
 *   and one line saying how this server reaches the machine.
 * - The toolbar, right under it: every verb in one row of flat buttons, as a file manager lays out
 *   its commands, set apart by spacing alone — Update while the machine carries another build
 *   (Enable when nothing is installed), Stop or Start its server, Restart it, Sync config while it
 *   is connected on this server's build, Configure SSH, Uninstall. A verb that cannot run now
 *   stays in place, greyed, and ONE muted sentence under the row says why and names them.
 * - Under the toolbar, one quiet line on the last config sync — when, or why it failed — and an
 *   attention notice listing what it could not carry: models keyed from this server's
 *   environment, and models the machine would not take.
 * - Reconnecting, while the server brings a machine it keeps connected back: for how long, which
 *   attempt and when the next, the last failure — and what the connection check found, once the
 *   server ran it after failures in a row.
 * - Progress, while a job is queued or running and after one: its own steps one per line, each
 *   marked done, current, failed or still to come; a job that finished well is a single quiet
 *   line. The log is folded underneath, open while the job runs, with a copy button for the whole
 *   of it. A failed job says at which step and why, what the connection check the server ran
 *   afterwards found, and offers Retry — and Force install when the failure offers it.
 * - Details: the facts, each label led by its glyph — how the machine is reached, the address its
 *   ssh alias names, the data directory; the server over there (with ssh's own words under it
 *   when it is out of reach), the last check, the build it carries — and last, quiet, the
 *   machine's own id with a copy button.
 *
 * This server's own entry has the header and Details alone: it runs no jobs and takes no verbs.
 *
 * No hint sits on words already on screen: the tooltip layer opens one only on an element that
 * shows no text of its own. The hints here sit on marks without words — the chip's glyph and the
 * copy buttons — and everything else is said in text.
 *
 * `MachineDetailBody` is a pure function of its props. The dialog around it adds the one read the
 * machines list does not carry: the host block (the list is the ssh config's aliases only).
 */
import { useEffect, useId, useState, type ReactNode } from "react";

import type { MachineInfo, MachineJob, SshHostResponse } from "@prismshadow/penguin-server/api";
import {
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
  MachineStatusPill,
  MachineToolbar as MachineToolbarView,
  Modal,
  Notice,
  NoticeStrip,
  Pill,
  RuledSection,
  Spinner,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { dismissNotice, envOnlyNoticeId, useNoticeDismissed } from "../../lib/notice-dismissals";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  configSyncView,
  envOnlyItems,
  jobView,
  machineChip,
  machineFacts,
  machineToolbar,
  reconnectView,
  type CheckLine,
  type ConfigSyncView,
  type Fact,
  type JobStep,
  type MachineChip,
  type StepState,
  type ToolbarItem,
  type ToolbarVerb,
} from "./machine-detail-view";

import { outOfDate, readMachine } from "./machines-view";

/**
 * Everything the dialog can ask its page to do for the machine. `use` is the whole pipeline —
 * what Enable, Update and Retry each run; `replaceProgram` the forced install a failure offers.
 */
export type MachineVerb = Exclude<ToolbarVerb, "enable" | "update"> | "use" | "replaceProgram";

/** The page verb a toolbar button asks for. */
const VERB_OF: Record<ToolbarVerb, MachineVerb> = {
  enable: "use",
  update: "use",
  stop: "stop",
  start: "start",
  restart: "restart",
  syncConfig: "syncConfig",
  configure: "configure",
  uninstall: "uninstall",
};

export interface MachineDetailBodyProps {
  machine: MachineInfo;
  /** The machine's job: queued, running, or its last finished one. */
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  /** The host block the alias names; null until read, or when the config has none this app can read. */
  host: SshHostResponse | null;
  /** The page's last error, repeated here because the dialog covers the notice that says it. */
  error: string | null;
  /** A request from this page is in flight: every verb waits for it. */
  busy: boolean;
  /** This server has no build to push, so an install has nothing to send. */
  noImage: boolean;
  /** The clock the reconnecting streak and the last check are measured from. */
  now?: number;
  /**
   * Whether the person closed the "keys from the environment" notice over what it names now:
   * shown when false (the default), hidden when true, and hidden while unknown (null), so a
   * closed notice never flashes in.
   */
  envOnlyDismissed?: boolean | null;
  /** Closes that notice; without it the notice has no close cross. */
  onDismissEnvOnly?: () => void;
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
 * The state as the shared status pill, the one the machine's card wears: the word in its tone, the
 * reason on the pill's hover.
 */
function StatusChip({ chip }: { chip: MachineChip }) {
  return <MachineStatusPill state={chip.state} label={chip.word} reason={chip.reason} />;
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
      <div className="flex items-center justify-between gap-2">
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
        {/* The whole log, as a code block copies its code: the button the code block wears. */}
        {open && (
          <CopyButton size="sm" text={job.log.join("\n")} label={S.machines.detail.copyLog} />
        )}
      </div>
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
 * One check's line: its mark in a box of one size — a check, an alert, a cross (only the mark takes
 * the danger ink), or a quiet dot for one not asked — then its sentence, and ssh's own words under
 * it in the muted ink. `data-check` and `data-state` name it for whatever reads the markup.
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
 * The toolbar: the shared `MachineToolbar` — the verbs in one row of flat buttons, a request in
 * flight greying every one — with each button asking the page for its verb, and `note`, the one
 * sentence saying why the greyed verbs wait, under it.
 */
export function MachineToolbar({
  items,
  busy,
  note = null,
  onAct,
}: {
  items: readonly ToolbarItem[];
  busy: boolean;
  note?: string | null;
  onAct: (verb: MachineVerb) => void;
}) {
  return (
    <MachineToolbarView
      items={items.map((item) => ({ ...item, held: item.held !== null }))}
      label={S.machines.detail.toolbar.label}
      busy={busy}
      note={note}
      onAct={(verb: ToolbarVerb) => onAct(VERB_OF[verb])}
    />
  );
}

/**
 * The last config sync: one quiet line — a check, or the danger cross on a failure, beside the
 * words — and, when the sync left anything behind, attention notices saying what and why: the
 * shared notice for the model keys only this server's environment holds, which the person may
 * close (as the initial-password banner can be) and which comes back when another such key
 * appears, and the models the machine would not take.
 */
function ConfigSync({
  view,
  envOnlyDismissed = false,
  onDismissEnvOnly,
}: {
  view: ConfigSyncView;
  envOnlyDismissed?: boolean | null;
  onDismissEnvOnly?: () => void;
}) {
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
      {view.envOnly && envOnlyDismissed === false && (
        <Notice
          tone="attention"
          className="mt-3"
          {...(onDismissEnvOnly !== undefined ? { dismiss: { onClick: onDismissEnvOnly } } : {})}
        >
          <span data-env-only="">{c.envOnly}</span>
        </Notice>
      )}
      {view.skipped.length > 0 && (
        <NoticeStrip
          tone="attention"
          data-config-sync-notice=""
          className="mt-3 rounded-md border px-3 py-2 text-sm"
        >
          <div data-skipped="">
            <p>{c.skippedTitle}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 break-words">
              {view.skipped.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </NoticeStrip>
      )}
    </>
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
  now = Date.now(),
  envOnlyDismissed = false,
  onDismissEnvOnly,
  onAct,
}: MachineDetailBodyProps) {
  const m = S.machines;
  const d = m.detail;
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const behind = outOfDate(machine, imageVersion);
  const chip = machineChip(reading, imageVersion);
  const facts = machineFacts(machine, host, imageVersion, locale, now);
  const view = !machine.local && job !== null ? jobView(job) : null;
  const toolbar = machineToolbar(machine, job, imageVersion, noImage);
  const reconnect = machine.local ? null : reconnectView(machine, locale, now);
  const configSync = machine.local ? null : configSyncView(machine, locale, now);
  const labelWidth = FACT_LABEL_WIDTH[locale];
  return (
    <div className="space-y-6">
      {error !== null && (
        <NoticeStrip tone="danger" className="rounded-md border px-3 py-2 text-sm">
          {error}
        </NoticeStrip>
      )}

      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <MachineTile />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusChip chip={chip} />
              {/* The version on offer is Details' to say, beside the installed one. */}
              {machine.installed !== null && (
                <Pill tone={behind ? "attention" : "neutral"}>v{machine.installed.version}</Pill>
              )}
              {machine.local && <Pill>{m.localTitle}</Pill>}
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              {machine.local ? d.describeLocal : d.describeRemote(machine.alias)}
            </p>
          </div>
        </div>
        {toolbar.items.length > 0 && (
          <div>
            {/* Why the greyed verbs wait, once, in words — never on a hover the reader has to find. */}
            <MachineToolbar
              items={toolbar.items}
              busy={busy}
              note={toolbar.sentence}
              onAct={onAct}
            />
            {configSync !== null && (
              <ConfigSync
                view={configSync}
                envOnlyDismissed={envOnlyDismissed}
                {...(onDismissEnvOnly !== undefined ? { onDismissEnvOnly } : {})}
              />
            )}
          </div>
        )}
      </div>

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
          {/* Line by line: an installer's refusal is the program's own error over its own line. */}
          {view.kind === "failed" && (
            <p className="mt-3 text-sm break-words whitespace-pre-line">
              {d.failedAtStep(view.stepName, view.message)}
            </p>
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
          {/* A failed job's way out sits under what went wrong, and only here. */}
          {view.kind === "failed" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                data-verb="retry"
                disabled={busy}
                onClick={() => onAct("use")}
              >
                <GlyphIcon d={ICONS.rotateCcw} size={ICON_SIZE.inlineGlyph} />
                {d.retry}
              </Button>
              {view.canReplaceProgram && (
                // Secondary: the confirmation that follows carries the danger tone.
                <Button
                  size="sm"
                  data-verb="replaceProgram"
                  disabled={busy}
                  onClick={() => onAct("replaceProgram")}
                >
                  <GlyphIcon d={ICONS.download} size={ICON_SIZE.inlineGlyph} />
                  {m.replaceProgram}
                </Button>
              )}
            </div>
          )}
          {job.log.length > 0 && <LogFold job={job} />}
        </RuledSection>
      )}

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
  const { alias, local } = body.machine;
  const [host, setHost] = useState<SshHostResponse | null>(null);
  // The "keys from this server's environment" notice, closed per account and per machine over
  // the keys it names (lib/notice-dismissals.ts).
  const envOnly = envOnlyItems(body.machine);
  const envOnlyId = envOnlyNoticeId(body.machine.id);
  const envOnlyDismissed = useNoticeDismissed(envOnlyId, envOnly);
  useEffect(() => {
    setHost(null);
    if (local) return;
    let cancelled = false;
    api.getSshHost(projectId, alias).then(
      (found) => {
        if (!cancelled) setHost(found);
      },
      // A block that lives in an included file, or none at all: Details names the alias alone.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, alias, local, hostEpoch]);
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
      <MachineDetailBody
        {...body}
        host={host}
        now={Date.now()}
        envOnlyDismissed={envOnlyDismissed}
        onDismissEnvOnly={() => dismissNotice(envOnlyId, envOnly)}
      />
    </Modal>
  );
}
