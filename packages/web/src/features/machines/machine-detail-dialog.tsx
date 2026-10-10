/**
 * The Machine dialog: everything about one machine that its card leaves out, and every verb it
 * takes, in four blocks under the alias.
 *
 * - The header: a tile, the state as one chip — a glyph (a spinner while a job runs) and one plain
 *   word, the reason behind it on the glyph's hover — the installed version, and one line saying
 *   how this server reaches the machine.
 * - Details: the facts, each label led by its glyph — how the machine is reached, the address its
 *   ssh alias names, the data directory; the server over there, the last check, the build it
 *   carries — and last, quiet, the machine's own id with a copy button.
 * - Progress, while a job is queued or running and after one: its steps one per line, each marked
 *   done, current, failed or still to come; a job that finished well is a single quiet line. The
 *   log is folded underneath, open while the job runs. A failed job says at which step and in the
 *   far side's own words, with Retry — and Force install when the failure offers it — under it.
 * - Actions: the one thing to do next, with what it does beside it; then the single steps
 *   (Maintain) and the ways out (Leave), each with its glyph. A verb that cannot run now stays in
 *   place, disabled.
 *
 * The one thing to do has exactly one home: under the failure when the last job failed, else the
 * first row of Actions. This server's own entry has the header and Details alone: it runs no jobs
 * and takes no verbs.
 *
 * `MachineDetailBody` is a pure function of its props. The dialog around it adds one read, the
 * host block, which the machines list does not carry: the list is the ssh config's aliases only.
 */
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import type { MachineInfo, MachineJob, SshHostResponse } from "@prismshadow/penguin-server/api";
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
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { DOT_TONE, jobMoving } from "./machine-card";
import { jobView, machineChip, machineFacts, primaryAction, verbHold } from "./machine-detail-view";
import type {
  DialogVerb,
  Fact,
  JobStep,
  MachineChip,
  StepState,
  VerbContext,
} from "./machine-detail-view";
import { outOfDate, readMachine } from "./machines-view";

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
  host: SshHostResponse | null;
  /** The page's last error, repeated here because the dialog covers the notice that says it. */
  error: string | null;
  /** A request from this page is in flight: every verb waits for it. */
  busy: boolean;
  /** This server has no build to push, so an install has nothing to send. */
  noImage: boolean;
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
 * One fact: the label muted, the value semibold — the part that is read — or muted when quiet;
 * `after` stands beside the value (the id's copy button).
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
    <span
      className={fact.quiet ? "text-fg-muted" : "font-semibold"}
      {...(fact.tooltip === undefined
        ? {}
        : { "data-tooltip": fact.tooltip, "data-tooltip-content": "text" })}
    >
      {fact.key === "root" ? breakAtSeparators(fact.value) : fact.value}
    </span>
  );
  return (
    <KeyValueRow
      label={<FactLabel icon={fact.icon} label={fact.label} width={labelWidth} />}
      mono={fact.mono}
    >
      {after === undefined ? (
        value
      ) : (
        <span className="inline-flex items-center gap-1.5">
          {value}
          {after}
        </span>
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
 * One verb: a button with its glyph before its word. Why it is held — or, at rest, what it does —
 * is its hint, on a wrapper either way, since a disabled button gets no hover of its own; `why`
 * is null where those words already stand beside the button. `data-verb` names the verb for
 * whatever reads the markup.
 */
function Verb({
  verb,
  glyph,
  label,
  why,
  hold,
  variant = "ghost",
  onClick,
}: {
  verb: MachineVerb;
  glyph: string;
  label: string;
  why: string | null;
  /** Why the verb cannot run now; null when it can. */
  hold: string | null;
  variant?: ButtonVariant;
  onClick: () => void;
}) {
  const hint = hold ?? why;
  return (
    <span
      className="inline-flex"
      {...(hint === null ? {} : { "data-tooltip": hint, "data-tooltip-content": "text" })}
    >
      <Button
        size="sm"
        variant={variant}
        disabled={hold !== null}
        onClick={onClick}
        data-verb={verb}
      >
        <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
        {label}
      </Button>
    </span>
  );
}

/**
 * A row of verbs and its caption: the caption on a line of its own above them on a phone; from
 * `sm` the pair joins the Actions grid, whose first column is as wide as the longest caption, so
 * the two rows' buttons line up in any language.
 */
function VerbRow({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:contents">
      <span className="text-xs text-fg-muted">{caption}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
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
  onAct,
}: MachineDetailBodyProps) {
  const m = S.machines;
  const d = m.detail;
  const reading = machine.local ? null : readMachine(machine, job, imageVersion);
  const behind = outOfDate(machine, imageVersion);
  const chip = machineChip(reading, imageVersion);
  const facts = machineFacts(machine, host, imageVersion, locale, Date.now());
  const view = !machine.local && job !== null ? jobView(job) : null;
  const primary = reading === null ? null : primaryAction(reading, behind, imageVersion);
  const labelWidth = FACT_LABEL_WIDTH[locale];
  const busyHold = busy ? d.hold.busy : null;
  const ctx: VerbContext = {
    busy,
    moving: jobMoving(job),
    noImage,
    connected: machine.connection !== null,
    unreachable: machine.status?.state === "unreachable",
  };
  const single = (verb: DialogVerb, glyph: string, label: string, why: string) => {
    const hold = verbHold(verb, ctx);
    return (
      <Verb
        key={verb}
        verb={verb}
        glyph={glyph}
        label={label}
        why={why}
        hold={hold === null ? null : d.hold[hold]}
        onClick={() => onAct(verb)}
      />
    );
  };
  return (
    <div className="space-y-6">
      {error !== null && (
        <NoticeStrip tone="danger" className="rounded-md border px-3 py-2 text-sm">
          {error}
        </NoticeStrip>
      )}

      <div className="flex items-start gap-3">
        <MachineTile />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip chip={chip} />
            {machine.installed !== null && (
              <Badge
                variant="soft"
                tone={behind ? "attention" : "neutral"}
                tooltip={
                  behind && imageVersion !== null ? d.newerAvailable(imageVersion) : undefined
                }
              >
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
          {/* A failed machine's one thing to do is here, under what went wrong — and only here. */}
          {view.kind === "failed" && primary?.kind === "retry" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Verb
                verb="use"
                variant="primary"
                glyph={primary.glyph}
                label={primary.label}
                why={null}
                hold={busyHold}
                onClick={() => onAct("use")}
              />
              {view.canReplaceProgram && (
                <Verb
                  verb="replaceProgram"
                  // Secondary: the confirmation that follows carries the danger tone.
                  variant="secondary"
                  glyph={ICONS.download}
                  label={m.replaceProgram}
                  why={m.replaceProgramWhy}
                  hold={busyHold}
                  onClick={() => onAct("replaceProgram")}
                />
              )}
              <span className="text-xs text-fg-muted">{primary.why}</span>
            </div>
          )}
          {job.log.length > 0 && <LogFold job={job} />}
        </RuledSection>
      )}

      {!machine.local && (
        <RuledSection level={3} title={d.actions}>
          <div className="grid items-center gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
            {primary !== null && primary.kind !== "retry" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
                <Verb
                  verb="use"
                  variant="primary"
                  glyph={primary.glyph}
                  label={primary.label}
                  why={null}
                  hold={busyHold}
                  onClick={() => onAct("use")}
                />
                <span className="text-xs text-fg-muted">{primary.why}</span>
              </div>
            )}
            {/* The single steps answer 409 while a job runs for the machine, so they wait for
                it; letting go of the machine does not. */}
            <VerbRow caption={d.maintenance}>
              {single("install", ICONS.download, m.verbs.install, m.verbs.installWhy)}
              {single("connect", ICONS.chainLink, m.verbs.connect, m.verbs.connectWhy)}
              {single("restart", ICONS.rotateCw, m.verbs.restart, m.verbs.restartWhy)}
              {single("configure", ICONS.gear, d.configureSsh, d.configureSshWhy)}
            </VerbRow>
            <VerbRow caption={d.leave}>
              {single("stopUsing", ICONS.plugLifted, m.stopUsing, m.verbs.stopUsingWhy)}
              {single("disconnect", ICONS.signOut, m.verbs.disconnect, m.verbs.disconnectWhy)}
              {single("release", ICONS.boxArrowOut, m.verbs.release, m.verbs.releaseWhy)}
            </VerbRow>
          </div>
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
  const { alias, local } = body.machine;
  const [host, setHost] = useState<SshHostResponse | null>(null);
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
  return (
    <Modal open title={alias} onClose={onClose} widthClass="sm:max-w-3xl">
      <MachineDetailBody {...body} host={host} />
    </Modal>
  );
}
