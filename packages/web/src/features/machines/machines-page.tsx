/**
 * Machines: the fleet as a list, and two verbs.
 *
 * "Use" is the whole of what a person wants from a machine — install or update the program
 * there, start its server, connect, hand over the Model config — as one job the server
 * queues per machine, so a batch is one tap. "Stop using" lets a machine go.
 *
 * One row per machine, this server first. A row is the machine's name in mono and one
 * line beneath it in the row's tone: the state in a word, and beside it the single detail
 * that matters — when it was last checked, the build it carries when that is behind this
 * server's, the far side's words when it failed. State is said once. At the row's end sits
 * a dot when nothing is needed, and "Use" when something is; the ⓘ opens the record and
 * the job's output in a pane beside the list, or a sheet on a narrow screen.
 *
 * Selection is the row: clicking one toggles it, a selected row is a tinted band with a
 * rail on its left edge, and every machine in use starts selected. The verbs are the card's
 * own footer, present only while something is selected. A queued or working row grows a
 * stepper under its name, one segment per step of the pipeline, fed by the step the server
 * says it is on.
 *
 * The list polls while a job is queued or running, and re-probes the servers on a widening
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
import { Sheet } from "../../components/ui/sheet";
import { Skeleton } from "../../components/ui/skeleton";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
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

/** The ⓘ at a row's end. */
const INFO_PATH = "M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0";

const MONO = "font-mono text-[13px] tabular-nums";

/** The reason a row gives under its name, when it has one: the far side's own words. */
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

/** True on screens wide enough for the detail pane to sit beside the table (Tailwind's lg). */
function useWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function MachinesPage() {
  useDocumentTitle(S.machines.pageTitle);
  const { locale } = useLocale();
  const wide = useWide();
  // Machines belong to the Project, like every other row in this nav group: switching
  // Projects switches which machines are listed, and using one here gives the machine to
  // THIS Project — the same one whose Model credentials it will be handed.
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [state, setState] = useState<MachinesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True while a POST has not come back yet. */
  const [posting, setPosting] = useState(false);
  /**
   * The batch selection. Null means "untouched": every machine in use, including ones added
   * later. Becomes a real set the first time someone clicks a row.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  /** The machine whose detail pane is open. */
  const [detailId, setDetailId] = useState<string | null>(null);

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
  const detail = useMemo(
    () => machines.find((machine) => machine.id === detailId) ?? null,
    [machines, detailId],
  );

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
  const toggleAdding = (id: string) => setAdding((prev) => toggled(prev, id));

  const noImage = state !== null && imageVersion === null;

  const detailPane =
    detail !== null ? (
      <DetailPane
        machine={detail}
        job={jobFor(jobs, detail.id)}
        imageVersion={imageVersion}
        locale={locale}
        busy={posting}
        onClose={() => setDetailId(null)}
        onUse={(replaceProgram) => void use([detail.id], replaceProgram)}
        onStopUsing={() => {
          setDetailId(null);
          void stopUsing([detail.id]);
        }}
      />
    ) : null;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{S.machines.pageTitle}</h1>
          <div className="flex items-center gap-3">
            {imageVersion !== null && (
              <span
                className={`${MONO} text-gray-500`}
                title={S.machines.imageVersion(imageVersion)}
              >
                {imageVersion}
              </span>
            )}
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
              menuClass="w-80 max-w-[calc(100vw-2rem)] origin-top-right"
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
                  {S.machines.addSelected(adding.size)}
                </Button>
              </div>
            </Dropdown>
          </div>
        </div>

        {error !== null && (
          <div className={`rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>{error}</div>
        )}
        {noImage && error === null && (
          <div className={`rounded-md border px-3 py-2 text-sm ${toneStrip.attention}`}>
            {S.machines.noImage}
          </div>
        )}

        {state === null ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <div
            className={`grid gap-4 ${wide && detail !== null ? "lg:grid-cols-[minmax(0,1fr)_20rem]" : ""}`}
          >
            <div className="min-w-0">
              <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                  {local !== null && (
                    <LocalRow
                      machine={local}
                      open={detailId === local.id}
                      onDetail={() => setDetailId(detailId === local.id ? null : local.id)}
                    />
                  )}
                  {inUse.map((machine) => (
                    <MachineRow
                      key={machine.id}
                      machine={machine}
                      job={jobFor(jobs, machine.id)}
                      imageVersion={imageVersion}
                      locale={locale}
                      selected={selection.has(machine.id)}
                      onToggle={() => togglePicked(machine.id)}
                      detailOpen={detailId === machine.id}
                      onDetail={() => setDetailId(detailId === machine.id ? null : machine.id)}
                      busy={posting}
                      onUse={() => void use([machine.id])}
                    />
                  ))}
                  {inUse.length === 0 && (
                    <li className="px-4 py-4 text-sm text-gray-500">
                      <p>{S.machines.noneInUse}</p>
                      <p className="mt-1 text-xs">{S.machines.sshHint}</p>
                    </li>
                  )}
                </ul>
                {/* The verbs: the card's own footer, present only while something is selected. */}
                {selectedIds.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-200 bg-gray-50/70 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/40">
                    <span className="tabular-nums">
                      {S.machines.selectedCount(selectedIds.length)}
                    </span>
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
                    <span className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={posting || noImage}
                        onClick={() => void use(selectedIds)}
                      >
                        {S.machines.use}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={posting}
                        onClick={() => void stopUsing(selectedIds)}
                      >
                        {S.machines.stopUsing}
                      </Button>
                    </span>
                  </div>
                )}
              </div>
            </div>
            {wide && detail !== null && (
              <aside className="min-w-0 rounded-xl border border-gray-200 dark:border-gray-800">
                {detailPane}
              </aside>
            )}
          </div>
        )}
      </div>
      {!wide && (
        <Sheet
          open={detail !== null}
          snap="full"
          onClose={() => setDetailId(null)}
          title={detail?.alias}
        >
          {detailPane}
        </Sheet>
      )}
    </div>
  );
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
      return word;
    case "working":
      return word;
    default:
      return checked === null ? word : `${word} · ${checked}`;
  }
}

/** The six-segment stepper under a working row, and the step it is on. */
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

/** The ⓘ at a row's end: quiet until the row is hovered or the pane is open. */
function InfoButton({
  alias,
  open,
  onClick,
}: {
  alias: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${S.machines.details}: ${alias}`}
      aria-pressed={open}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`rounded-md p-1 transition-opacity ${
        open
          ? "text-gray-900 dark:text-gray-100"
          : "text-gray-400 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:text-gray-700 dark:hover:text-gray-200"
      }`}
    >
      <GlyphIcon d={INFO_PATH} size={ICON_SIZE.rowLead} />
    </button>
  );
}

/** This server's own row: not selectable — it is where the page is served from. */
function LocalRow({
  machine,
  open,
  onDetail,
}: {
  machine: MachineInfo;
  open: boolean;
  onDetail: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`${MONO} truncate font-medium`}>{machine.alias}</span>
          <span className="shrink-0 rounded border border-gray-200 px-1.5 py-px text-[11px] text-gray-500 dark:border-gray-700">
            {S.machines.localTitle}
          </span>
        </div>
        <div className={`truncate text-xs ${toneInk.success}`}>
          {S.machines.state.serving}
          {machine.installed !== null && ` · ${machine.installed.version}`}
        </div>
      </div>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.success}`} aria-hidden="true" />
      <InfoButton alias={machine.alias} open={open} onClick={onDetail} />
    </li>
  );
}

function MachineRow({
  machine,
  job,
  imageVersion,
  locale,
  selected,
  onToggle,
  detailOpen,
  onDetail,
  busy,
  onUse,
}: {
  machine: MachineInfo;
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  selected: boolean;
  onToggle: () => void;
  detailOpen: boolean;
  onDetail: () => void;
  busy: boolean;
  onUse: () => void;
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
  return (
    <li
      aria-selected={selected}
      onClick={onToggle}
      className={`group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
        selected
          ? "bg-gray-100/80 shadow-[inset_3px_0_0_var(--accent-bg)] dark:bg-gray-800/50"
          : "hover:bg-gray-50 dark:hover:bg-gray-900/40"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className={`${MONO} truncate font-medium`}>{machine.alias}</div>
        {moving ? (
          <Stepper step={step} caption={caption} />
        ) : (
          <div
            className={`truncate text-xs ${toneInk[tone]}`}
            title={reasonText(reading) ?? undefined}
          >
            {stateLine(reading, machine, locale)}
          </div>
        )}
      </div>
      {wantsUse(reading) ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onUse();
          }}
        >
          {S.machines.use}
        </Button>
      ) : (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]} ${moving ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
      )}
      <InfoButton alias={machine.alias} open={detailOpen} onClick={onDetail} />
    </li>
  );
}

/** The record and the job's output for one machine, beside the table or in a sheet. */
function DetailPane({
  machine,
  job,
  imageVersion,
  locale,
  busy,
  onClose,
  onUse,
  onStopUsing,
}: {
  machine: MachineInfo;
  job: MachineJob | null;
  imageVersion: string | null;
  locale: "zh" | "en";
  busy: boolean;
  onClose: () => void;
  onUse: (replaceProgram: boolean) => void;
  onStopUsing: () => void;
}) {
  const reading = readMachine(machine, job, imageVersion);
  const tone = readingTone(reading);
  const step = stepIndex(job);
  const m = S.machines;
  return (
    <div className="space-y-3 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`${MONO} truncate text-base font-semibold`}>{machine.alias}</div>
          <div className={`text-xs ${toneInk[tone]}`}>
            {machine.local ? m.state.serving : m.state[reading.kind]}
            {job !== null && step >= 0 && (job.running || job.queued) && (
              <span className="text-gray-500">
                {" · "}
                {m.stepOf(step + 1, MACHINE_PHASES.length)}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={S.common.close}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
        >
          ×
        </button>
      </div>
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
        <div>
          <div className="mb-1 text-xs text-gray-500">{m.output}</div>
          <pre className="max-h-64 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-gray-500 dark:bg-gray-900">
            {job.log.slice(0, -1).join("\n")}
            {job.log.length > 1 ? "\n" : ""}
            <span className="text-gray-900 dark:text-gray-100">{job.log.at(-1)}</span>
          </pre>
        </div>
      )}
      {!machine.local && (
        <div className="flex flex-wrap gap-2 pt-1">
          {reading.kind === "failed" && reading.canReplaceProgram && (
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              title={m.replaceProgramWhy}
              onClick={() => onUse(true)}
            >
              {m.replaceProgram}
            </Button>
          )}
          {wantsUse(reading) && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onUse(false)}>
              {m.use}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onStopUsing}>
            {m.stopUsing}
          </Button>
        </div>
      )}
    </div>
  );
}
