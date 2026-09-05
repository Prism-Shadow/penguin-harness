/**
 * Machines: the fleet as cards, and two verbs.
 *
 * Enable is the whole of what a person wants from a machine — install or update the program
 * there, start its server, connect, hand over the Model config — as one job the server
 * queues per machine, so a batch is one tap. Disable lets a machine go.
 *
 * One card per machine, one per row, this server first. A card at rest is two lines: the
 * machine's name in mono, and beneath it the state in a word with the single detail that
 * matters beside it — when it was last checked, the build it carries when that is behind
 * this server's, the far side's words when it failed. State is said once: the dot at the
 * card's edge is blue for a live link — this server, and a held connection — amber and red
 * for what needs a person, grey for settled. Everything else — the build, the install
 * date, the server, the machine id, the job's output, the forced install — lives inside
 * the card and unfolds on the chevron, so the fleet at rest is names and dots.
 *
 * Selection is the card: clicking one toggles it, a selected card darkens its border, and
 * every machine in use starts selected. The verbs are plug and unplug icon buttons in a bar
 * that keeps a fixed slot between the title and the cards, so the cards never move when a
 * selection appears or goes. A queued or working card grows a stepper under its name, one
 * segment per step of the pipeline, fed by the step the server says it is on.
 *
 * The page polls while a job is queued or running, and re-probes the servers on a widening
 * schedule (probe-schedule.ts) so a machine that went quiet is noticed without a tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MachineInfo, MachineJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatDateTime, formatMessageTime } from "../../lib/format";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { Skeleton } from "../../components/ui/skeleton";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ChevronDown, NAV_ICONS } from "../../components/ui/icons";
import {
  MACHINE_PHASES,
  anyJobPending,
  behindMachines,
  defaultSelection,
  installedMachines,
  jobFor,
  localMachine,
  readMachine,
  readingTone,
  wantsUse,
} from "./machines-view";
import type { MachineReading } from "./machines-view";
import { MAX_VISIBLE_MACHINES, highlightSegments, matchMachines } from "./machines-match";
import { probeDelayMs, probeFingerprint } from "./probe-schedule";

/** How often the page re-reads the list while a job is queued or running. */
const POLL_MS = 1500;

/**
 * Enable: a plug seated in its socket, cord trailing. Disable: the plug lifted clear of the
 * socket — prongs in the air, a gap, and the empty socket cup below. The two must differ in
 * silhouette, not in detail: at icon size a detail is invisible.
 */
const PLUG_PATH = "M9 2v4M15 2v4M6 6h12v4a6 6 0 0 1-12 0V6zM12 16v6";
const UNPLUG_PATH = "M9 2v3M15 2v3M6 5h12v3a6 6 0 0 1-12 0V5zM7 22h10M7 22v-4M17 22v-4";

const MONO = "font-mono text-[13px] tabular-nums";

/** The reason a card gives under its name, when it has one: the far side's own words. */
function reasonText(reading: MachineReading): string | null {
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

/** The one line under a machine's name: its state, and the one detail that matters beside it. */
function stateLine(reading: MachineReading, machine: MachineInfo, locale: "zh" | "en"): string {
  const m = S.machines;
  const word = m.state[reading.kind];
  const checked =
    machine.connection !== null
      ? m.now
      : machine.status !== null
        ? formatMessageTime(new Date(machine.status.checkedAt).getTime(), locale)
        : null;
  switch (reading.kind) {
    case "behind":
      return `${word} · ${reading.version}`;
    case "failed":
      return `${word} · ${reading.message}`;
    case "queued":
    case "working":
      return word;
    default:
      return checked === null ? word : `${word} · ${checked}`;
  }
}

/** Where the stepper stands: how many steps are done, and whether one is under way. */
function stepIndex(job: MachineJob | null): number {
  if (job === null || job.phase === null) return -1;
  return MACHINE_PHASES.indexOf(job.phase);
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function MachinesPage() {
  useDocumentTitle(S.machines.pageTitle);
  const { locale } = useLocale();
  // Machines belong to the Project, like every other row in this nav group: switching
  // Projects switches which machines are listed, and enabling one here gives the machine to
  // THIS Project — the same one whose Model credentials it will be handed.
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [state, setState] = useState<MachinesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True while a POST has not come back yet. */
  const [posting, setPosting] = useState(false);
  /**
   * The batch selection. Null means "untouched": every machine in use, including ones added
   * later. Becomes a real set the first time someone clicks a card.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  /** Cards unfolded to show their details. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  /** The picker panel; closing it always clears the query and its picks, so it reopens fresh. */
  const [pickerOpen, setPickerOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<Set<string>>(() => new Set());
  const setPickerOpen = (next: boolean) => {
    setPickerOpenState(next);
    if (!next) {
      setQuery("");
      setAdding(new Set());
    }
  };

  const load = useCallback(async () => {
    if (projectId === null) return; // No Project chosen yet: there is nothing to list machines for.
    try {
      setState(await api.getMachines(projectId));
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a job is queued or running. Chained timeouts rather than an interval: a
  // slow response must not stack requests behind itself.
  const pending = state !== null && anyJobPending(state);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        void loadRef.current().finally(() => {
          if (!cancelled) tick();
        });
      }, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending]);

  const machines = useMemo(() => state?.machines ?? [], [state]);
  const inUse = useMemo(() => (state === null ? [] : installedMachines(state)), [state]);
  const local = useMemo(() => (state === null ? null : localMachine(state)), [state]);
  const jobs = useMemo(() => state?.jobs ?? [], [state]);
  const imageVersion = state?.imageVersion ?? null;
  const selection = useMemo(
    () => picked ?? (state === null ? new Set<string>() : defaultSelection(state)),
    [picked, state],
  );
  const inUseIds = useMemo(() => new Set(inUse.map((machine) => machine.id)), [inUse]);
  const selectedIds = useMemo(
    () => [...selection].filter((id) => inUseIds.has(id)),
    [selection, inUseIds],
  );
  /** Machines in use that carry another build: what one tap brings to this server's version. */
  const behind = useMemo(() => (state === null ? [] : behindMachines(state)), [state]);

  /** Hosts the picker offers: in the config, not this machine, not already in use here. */
  const addable = useMemo(
    () => machines.filter((machine) => !machine.local && !inUseIds.has(machine.id)),
    [machines, inUseIds],
  );
  const matched = useMemo(() => matchMachines(addable, query), [addable, query]);
  const visible = matched.slice(0, MAX_VISIBLE_MACHINES);
  const hiddenCount = matched.length - visible.length;

  /**
   * Re-probe the servers in use on a widening schedule. Separate from the job poll above:
   * that one follows a job and stops when the queue drains, this one watches machines
   * nobody is touching and has to stay cheap for hours.
   */
  const settledRounds = useRef(0);
  const lastPrint = useRef<string | null>(null);
  const probe = useCallback(async () => {
    if (projectId === null) return;
    try {
      const next = await api.probeMachines(projectId);
      const print = probeFingerprint(next.machines);
      // A round that changed nothing widens the interval; anything moving resets it.
      settledRounds.current = print === lastPrint.current ? settledRounds.current + 1 : 0;
      lastPrint.current = print;
      setState(next);
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, [projectId]);

  const probeRef = useRef(probe);
  probeRef.current = probe;
  /** Nothing in use anywhere: there is no server to ask about, so no timer runs at all. */
  const hasInUse = inUse.length > 0;
  useEffect(() => {
    if (!hasInUse) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (delay: number) => {
      timer = setTimeout(() => {
        void probeRef.current().finally(() => {
          if (!cancelled) arm(probeDelayMs(settledRounds.current));
        });
      }, delay);
    };
    // The first probe is immediate: opening the page is itself a reason to look.
    arm(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasInUse]);

  const post = async (run: (projectId: string) => Promise<MachinesResponse>) => {
    if (projectId === null) return;
    setPosting(true);
    try {
      setState(await run(projectId));
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setPosting(false);
    }
  };

  const use = (ids: string[], replaceProgram = false) =>
    post(async (project) => {
      const answer = await api.useMachines(project, ids, replaceProgram);
      if (answer.refused.length > 0) {
        const byId = new Map(machines.map((machine) => [machine.id, machine.alias]));
        // Set after `post` clears the error, by way of the microtask order: post awaits
        // this, so its setError(null) runs first and this one stands.
        queueMicrotask(() =>
          setError(
            answer.refused
              .map(({ machineId, why }) => {
                const alias = byId.get(machineId) ?? machineId;
                if (why === "self") return S.machines.refusedSelf(alias);
                if (why === "no-image") return S.machines.noImage;
                return S.machines.refusedUnknown(alias);
              })
              .join(" "),
          ),
        );
      }
      return answer;
    });
  const stopUsing = (ids: string[]) => post((project) => api.stopUsingMachines(project, ids));

  const togglePicked = (id: string) => setPicked(toggled(picked ?? selection, id));
  const pickAll = () => setPicked(new Set(inUse.map((machine) => machine.id)));
  const pickNone = () => setPicked(new Set());
  const toggleExpanded = (id: string) => setExpanded((prev) => toggled(prev, id));
  const toggleAdding = (id: string) => setAdding((prev) => toggled(prev, id));

  const noImage = state !== null && imageVersion === null;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{S.machines.pageTitle}</h1>
          <div className="flex items-center gap-2">
            {behind.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                disabled={posting || pending}
                onClick={() => void use(behind.map((machine) => machine.id))}
              >
                {S.machines.updateAll(behind.length)}
              </Button>
            )}
            <Dropdown
              open={pickerOpen}
              setOpen={setPickerOpen}
              button={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={state === null || addable.length === 0 || noImage}
                  onClick={() => setPickerOpen(!pickerOpen)}
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                >
                  <GlyphIcon d={NAV_ICONS.machines} size={ICON_SIZE.inlineGlyph} />
                  {S.machines.add}
                </Button>
              }
              menuClass="top-full right-0 mt-1 w-80 max-w-[calc(100vw-2rem)] origin-top-right"
            >
              {/* The search row: matched characters bright and the rest dimmed — with a
                  subsequence match, an unmarked row looks wrong. */}
              <div className="px-2 pt-2 pb-1">
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={S.machines.search}
                  aria-label={S.machines.search}
                  className="w-full rounded-md border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-gray-400 focus:border-gray-400 dark:border-gray-700 dark:placeholder:text-gray-500 dark:focus:border-gray-500"
                />
              </div>
              <ul
                role="listbox"
                aria-multiselectable="true"
                className="max-h-64 overflow-y-auto py-1"
              >
                {visible.map(({ machine, positions }) => {
                  const on = adding.has(machine.id);
                  return (
                    <li key={machine.id} role="option" aria-selected={on}>
                      <button
                        type="button"
                        onClick={() => toggleAdding(machine.id)}
                        className={`flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                          on
                            ? "bg-gray-100 shadow-[inset_3px_0_0_var(--accent-bg)] dark:bg-gray-800/60"
                            : ""
                        }`}
                      >
                        <span
                          className={`min-w-0 flex-1 truncate ${MONO} ${positions.length > 0 ? "text-gray-400 dark:text-gray-500" : ""}`}
                        >
                          {positions.length === 0
                            ? machine.alias
                            : highlightSegments(machine.alias, positions).map((segment, i) => (
                                <span
                                  key={i}
                                  className={
                                    segment.hit
                                      ? "font-semibold text-gray-900 dark:text-white"
                                      : undefined
                                  }
                                >
                                  {segment.text}
                                </span>
                              ))}
                        </span>
                        {/* Installed by this server for another Project: adding it costs no
                            transfer, and the version says whether it is current. */}
                        {machine.elsewhere !== undefined && (
                          <span className={`shrink-0 text-xs ${toneInk.success}`}>
                            {machine.elsewhere.version}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {visible.length === 0 && (
                  <li className="px-3.5 py-2 text-sm text-gray-400 dark:text-gray-500">
                    {addable.length === 0 ? S.machines.empty : S.machines.noMatch}
                  </li>
                )}
                {hiddenCount > 0 && (
                  <li className="px-3.5 pt-1 pb-1.5 text-xs text-gray-400 dark:text-gray-500">
                    {S.machines.more(hiddenCount)}
                  </li>
                )}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-3 py-2 dark:border-gray-800">
                <span className="text-xs text-gray-500">
                  {S.machines.selectedCount(adding.size)}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={adding.size === 0 || posting}
                  onClick={() => {
                    const ids = [...adding];
                    setPickerOpen(false);
                    void use(ids);
                  }}
                >
                  <GlyphIcon d={PLUG_PATH} size={ICON_SIZE.inlineGlyph} />
                  {S.machines.addSelected(adding.size)}
                </Button>
              </div>
            </Dropdown>
          </div>
        </div>

        {error !== null && (
          <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
            {error}
          </div>
        )}
        {noImage && error === null && (
          <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.attention}`}>
            {S.machines.noImage}
          </div>
        )}

        {/* The selection bar: a fixed slot between the title and the cards, so the cards
            never move when a selection appears or goes. The count is the slot's label; the
            verbs are dimmed until something is selected. */}
        <div className="mt-3 flex h-10 items-center gap-3 px-1 text-xs text-gray-500">
          <span className="tabular-nums">{S.machines.selectedCount(selectedIds.length)}</span>
          {inUse.length > 0 && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="hover:text-gray-900 hover:underline dark:hover:text-gray-100"
                onClick={pickAll}
              >
                {S.machines.pickAll}
              </button>
              ·
              <button
                type="button"
                className="hover:text-gray-900 hover:underline dark:hover:text-gray-100"
                onClick={pickNone}
              >
                {S.machines.pickNone}
              </button>
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <IconAction
              label={S.machines.use}
              d={PLUG_PATH}
              disabled={selectedIds.length === 0 || posting || noImage}
              onClick={() => void use(selectedIds)}
            />
            <IconAction
              label={S.machines.stopUsing}
              d={UNPLUG_PATH}
              disabled={selectedIds.length === 0 || posting}
              onClick={() => void stopUsing(selectedIds)}
            />
          </span>
        </div>

        {state === null ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <ul className="space-y-2">
            {local !== null && (
              <LocalCard
                machine={local}
                locale={locale}
                open={expanded.has(local.id)}
                onToggleOpen={() => toggleExpanded(local.id)}
              />
            )}
            {inUse.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                job={jobFor(jobs, machine.id)}
                imageVersion={imageVersion}
                locale={locale}
                selected={selection.has(machine.id)}
                onToggle={() => togglePicked(machine.id)}
                open={expanded.has(machine.id)}
                onToggleOpen={() => toggleExpanded(machine.id)}
                busy={posting}
                onUse={(replaceProgram) => void use([machine.id], replaceProgram)}
                onStopUsing={() => void stopUsing([machine.id])}
              />
            ))}
            {inUse.length === 0 && (
              <li className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700">
                <p>{S.machines.noneInUse}</p>
                <p className="mt-1 text-xs">{S.machines.sshHint}</p>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/** An icon verb: plug (enable) and unplug (disable), for the bar and inside a card. */
function IconAction({
  label,
  d,
  disabled = false,
  onClick,
  emphasis = false,
}: {
  label: string;
  d: string;
  disabled?: boolean;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`rounded-md border p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        emphasis
          ? "border-gray-300 text-gray-900 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
          : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-900 dark:hover:border-gray-700 dark:hover:text-gray-100"
      }`}
    >
      <GlyphIcon d={d} size={ICON_SIZE.iconButton} />
    </button>
  );
}

/** The chevron that unfolds a card's details. */
function ExpandButton({
  alias,
  open,
  controls,
  onClick,
}: {
  alias: string;
  open: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${S.machines.details}: ${alias}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      <ChevronDown
        size={ICON_SIZE.chevron}
        className={`transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/** The six-segment stepper under a working card, and the step it is on. */
function Stepper({ step, caption }: { step: number; caption: string }) {
  return (
    <div className="mt-1.5 w-44 max-w-full">
      <div className="flex gap-0.5" aria-hidden="true">
        {MACHINE_PHASES.map((phase, index) => (
          <span
            key={phase}
            className={`h-[3px] flex-1 rounded-sm ${
              index < step
                ? toneDot.busy
                : index === step
                  ? `${toneDot.busy} animate-pulse`
                  : "bg-gray-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>
      <div className={`mt-1 truncate text-xs ${toneInk.busy}`}>{caption}</div>
    </div>
  );
}

const CARD = "rounded-xl border px-4 py-3 text-sm transition-colors";

const domId = (machineId: string) => `machine-details-${machineId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** This server's own card: not selectable — it is where the page is served from. */
function LocalCard({
  machine,
  locale,
  open,
  onToggleOpen,
}: {
  machine: MachineInfo;
  locale: "zh" | "en";
  open: boolean;
  onToggleOpen: () => void;
}) {
  const id = domId(machine.id);
  return (
    <li className={`${CARD} border-gray-200 dark:border-gray-800`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`${MONO} truncate font-medium`}>{machine.alias}</span>
            <span className="shrink-0 rounded border border-gray-200 px-1.5 py-px text-[11px] text-gray-500 dark:border-gray-700">
              {S.machines.localTitle}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-500">{S.machines.state.serving}</div>
        </div>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.link}`} aria-hidden="true" />
        <ExpandButton alias={machine.alias} open={open} controls={id} onClick={onToggleOpen} />
      </div>
      <div id={id} hidden={!open}>
        <Details machine={machine} job={null} locale={locale} />
      </div>
    </li>
  );
}

function MachineCard({
  machine,
  job,
  imageVersion,
  locale,
  selected,
  onToggle,
  open,
  onToggleOpen,
  busy,
  onUse,
  onStopUsing,
}: {
  machine: MachineInfo;
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  selected: boolean;
  onToggle: () => void;
  open: boolean;
  onToggleOpen: () => void;
  busy: boolean;
  onUse: (replaceProgram: boolean) => void;
  onStopUsing: () => void;
}) {
  const reading = readMachine(machine, job, imageVersion);
  const tone = readingTone(reading);
  const moving = reading.kind === "working" || reading.kind === "queued";
  const step = moving ? stepIndex(job) : -1;
  const caption =
    reading.kind === "queued"
      ? S.machines.queued
      : step >= 0
        ? S.machines.phase[MACHINE_PHASES[step]!]
        : S.machines.working;
  // The line under the name is grey unless it names a problem: the dot carries the state.
  const lineInk =
    tone === "attention" || tone === "danger" ? toneInk[tone] : "text-gray-500 dark:text-gray-400";
  const id = domId(machine.id);
  return (
    <li
      aria-selected={selected}
      onClick={onToggle}
      className={`${CARD} cursor-pointer ${
        selected
          ? "border-gray-900 bg-gray-100/70 dark:border-gray-200 dark:bg-gray-800/40"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className={`${MONO} truncate font-medium`}>{machine.alias}</div>
          {moving ? (
            <Stepper step={step} caption={caption} />
          ) : (
            <div
              className={`mt-0.5 truncate text-xs ${lineInk}`}
              title={reasonText(reading) ?? undefined}
            >
              {stateLine(reading, machine, locale)}
            </div>
          )}
        </div>
        {wantsUse(reading) && (
          <IconAction
            label={S.machines.use}
            d={PLUG_PATH}
            disabled={busy}
            onClick={() => onUse(false)}
            emphasis
          />
        )}
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]} ${moving ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
        <ExpandButton alias={machine.alias} open={open} controls={id} onClick={onToggleOpen} />
      </div>
      <div id={id} hidden={!open} onClick={(event) => event.stopPropagation()}>
        <Details machine={machine} job={job} locale={locale} />
        <div className="mt-3 flex flex-wrap gap-2">
          {reading.kind === "failed" && reading.canReplaceProgram && (
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              title={S.machines.replaceProgramWhy}
              onClick={() => onUse(true)}
            >
              {S.machines.replaceProgram}
            </Button>
          )}
          {wantsUse(reading) && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onUse(false)}>
              <GlyphIcon d={PLUG_PATH} size={ICON_SIZE.inlineGlyph} />
              {S.machines.use}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onStopUsing}>
            <GlyphIcon d={UNPLUG_PATH} size={ICON_SIZE.inlineGlyph} />
            {S.machines.stopUsing}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** The record and the job's output, unfolded inside a card. */
function Details({
  machine,
  job,
  locale,
}: {
  machine: MachineInfo;
  job: MachineJob | null;
  locale: "zh" | "en";
}) {
  const m = S.machines;
  return (
    <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {machine.installed !== null && (
          <>
            <dt className="text-gray-500">{m.detailInstalled}</dt>
            <dd className={MONO}>{machine.installed.version}</dd>
            <dt className="text-gray-500">{m.detailSince}</dt>
            <dd>{formatDateTime(machine.installed.at)}</dd>
          </>
        )}
        {machine.status !== null && (
          <>
            <dt className="text-gray-500">{m.detailServer}</dt>
            <dd>
              {machine.status.state === "running"
                ? m.serverUpOn(machine.status.port ?? 0)
                : machine.status.state === "stopped"
                  ? m.state.stopped
                  : (machine.status.detail ?? m.state.unreachable)}
            </dd>
            <dt className="text-gray-500">{m.detailChecked}</dt>
            <dd>{formatMessageTime(new Date(machine.status.checkedAt).getTime(), locale)}</dd>
          </>
        )}
        {machine.machineId !== null && (
          <>
            <dt className="text-gray-500">{m.detailMachineId}</dt>
            <dd className={`${MONO} truncate`}>{machine.machineId}</dd>
          </>
        )}
      </dl>
      {job !== null && job.log.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs text-gray-500">{m.output}</div>
          <pre className="max-h-64 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-gray-500 dark:bg-gray-900">
            {job.log.slice(0, -1).join("\n")}
            {job.log.length > 1 ? "\n" : ""}
            <span className="text-gray-900 dark:text-gray-100">{job.log.at(-1)}</span>
          </pre>
        </div>
      )}
    </div>
  );
}
