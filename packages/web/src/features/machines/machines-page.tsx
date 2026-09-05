/**
 * Machines: the hosts this Project runs agents on, and two verbs.
 *
 * "Use" is the whole of what a person wants from a machine — install or update the program
 * there, start its server, connect, hand over the Model config — as one job the server
 * queues per machine, so a batch is one tap. "Stop using" lets a machine go. Every row is
 * one sentence saying where the machine is, and the sentence names what "use" would fix.
 *
 * Batch first: the rows carry checkboxes, every machine in use is ticked until someone
 * changes that, and the two verbs act on the selection. Machines not yet in use are behind
 * an "Add" picker — a fuzzy search over the ssh config, which can declare hundreds of hosts.
 *
 * The list polls while a job is queued or running, and re-probes the servers on a widening
 * schedule (probe-schedule.ts) so a machine that went quiet is noticed without a tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MachineInfo, MachineJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatDateTime } from "../../lib/format";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CheckIcon, ChevronDown, NAV_ICONS } from "../../components/ui/icons";
import {
  anyJobPending,
  behindMachines,
  defaultSelection,
  installedMachines,
  jobFor,
  localMachine,
  readMachine,
  readingTone,
} from "./machines-view";
import type { MachineReading } from "./machines-view";
import { MAX_VISIBLE_MACHINES, highlightSegments, matchMachines } from "./machines-match";
import { probeDelayMs, probeFingerprint } from "./probe-schedule";

/** How often the page re-reads the list while a job is queued or running. */
const POLL_MS = 1500;

/**
 * A drawn tick box, the same one for the batch bar, the rows and the picker. A real
 * checkbox semantically (role, aria-checked, keyboard), but drawn here: the browser's own
 * control takes the platform's colours and size, which sits badly beside the app's buttons.
 */
function Tick({
  checked,
  label,
  onToggle,
  className = "",
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 ${
        checked
          ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
          : "border-gray-300 bg-white hover:border-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:hover:border-gray-400"
      } ${className}`}
    >
      {checked && <CheckIcon size={11} />}
    </button>
  );
}

/** The one sentence a row says. */
function readingText(reading: MachineReading): string {
  const m = S.machines;
  switch (reading.kind) {
    case "queued":
      return m.queued;
    case "working":
      return reading.step === null ? m.working : m.workingAt(reading.step);
    case "failed":
      return `${m.failedAt(reading.step)} ${reading.message}`;
    case "ready":
      return reading.port === null ? m.ready : m.readyOn(reading.port);
    case "installedOnly":
      return m.installedOnly;
    case "behind":
      return m.behind(reading.version);
    case "notConnected":
      return m.notConnected;
    case "unreachable":
      return reading.detail === null ? m.unreachable : m.unreachableDetail(reading.detail);
    case "stopped":
      return m.stopped;
    case "unknown":
      return m.notChecked;
  }
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function MachinesPage() {
  useDocumentTitle(S.machines.pageTitle);
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
   * later. Becomes a real set the first time someone ticks or unticks a row.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  /** Rows whose details are unfolded. */
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  /** The picker panel; closing it always clears the query and its ticks, so it reopens fresh. */
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
  const allSelected = inUse.length > 0 && selectedIds.length === inUse.length;
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
  const toggleAll = () =>
    setPicked(allSelected ? new Set() : new Set(inUse.map((machine) => machine.id)));
  const toggleOpen = (id: string) => setOpen((prev) => toggled(prev, id));
  const toggleAdding = (id: string) => setAdding((prev) => toggled(prev, id));

  const noImage = state !== null && imageVersion === null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{S.machines.pageTitle}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{S.machines.pageDesc}</p>
      </header>

      {imageVersion !== null && state !== null && (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm ${
            behind.length > 0 ? toneStrip.attention : "border-gray-200 dark:border-gray-800"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium">{S.machines.imageVersion(imageVersion)}</span>
            <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
              {behind.length > 0
                ? S.machines.behindCount(behind.length)
                : inUse.length > 0
                  ? S.machines.allCurrent
                  : null}
            </span>
          </span>
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
        </div>
      )}

      {error !== null && (
        <div className={`rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>{error}</div>
      )}
      {noImage && error === null && (
        <div className={`rounded-md border px-3 py-2 text-sm ${toneStrip.attention}`}>
          {S.machines.noImage}
        </div>
      )}

      {state === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          {local !== null && (
            <section className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.success}`} />
                <span className="truncate text-sm font-medium">{local.alias}</span>
                <span className="text-xs text-gray-500">{S.machines.localTitle}</span>
              </div>
              <p className={`mt-0.5 text-xs ${toneInk.success}`}>{S.machines.localReady}</p>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{S.machines.inUseTitle(inUse.length)}</h2>
              <Dropdown
                open={pickerOpen}
                setOpen={setPickerOpen}
                button={
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={addable.length === 0 || noImage}
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
                          className="flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Tick
                            checked={on}
                            label={machine.alias}
                            onToggle={() => toggleAdding(machine.id)}
                          />
                          <span
                            className={`min-w-0 flex-1 truncate ${positions.length > 0 ? "text-gray-400 dark:text-gray-500" : ""}`}
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

            {inUse.length === 0 ? (
              <EmptyState title={S.machines.noneInUse} description={S.machines.sshHint} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
                  <div className="flex items-center gap-2.5 text-sm">
                    <Tick checked={allSelected} label={S.machines.selectAll} onToggle={toggleAll} />
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    >
                      {S.machines.selectedCount(selectedIds.length)}
                    </button>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={selectedIds.length === 0 || posting || noImage}
                      onClick={() => void use(selectedIds)}
                    >
                      {S.machines.useSelected(selectedIds.length)}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={selectedIds.length === 0 || posting}
                      onClick={() => void stopUsing(selectedIds)}
                    >
                      {S.machines.stopUsing}
                    </Button>
                  </div>
                </div>

                <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {inUse.map((machine) => (
                    <MachineRow
                      key={machine.id}
                      machine={machine}
                      job={jobFor(jobs, machine.id)}
                      imageVersion={imageVersion}
                      checked={selection.has(machine.id)}
                      onToggle={() => togglePicked(machine.id)}
                      open={open.has(machine.id)}
                      onToggleOpen={() => toggleOpen(machine.id)}
                      busy={posting}
                      onReplaceProgram={() => void use([machine.id], true)}
                    />
                  ))}
                </ul>
                <p className="text-xs text-gray-500">{S.machines.sshHint}</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function MachineRow({
  machine,
  job,
  imageVersion,
  checked,
  onToggle,
  open,
  onToggleOpen,
  busy,
  onReplaceProgram,
}: {
  machine: MachineInfo;
  job: MachineJob | null;
  imageVersion: string | null;
  checked: boolean;
  onToggle: () => void;
  open: boolean;
  onToggleOpen: () => void;
  busy: boolean;
  onReplaceProgram: () => void;
}) {
  const reading = readMachine(machine, job, imageVersion);
  const tone = readingTone(reading);
  const detailsId = `machine-details-${machine.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const moving = reading.kind === "working" || reading.kind === "queued";
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2.5">
        <Tick checked={checked} label={machine.alias} onToggle={onToggle} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]} ${moving ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            <span className="truncate text-sm font-medium">{machine.alias}</span>
          </div>
          <p className={`mt-0.5 text-xs break-words ${toneInk[tone]}`}>{readingText(reading)}</p>
          {reading.kind === "failed" && reading.canReplaceProgram && (
            <div className="mt-1.5">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                title={S.machines.replaceProgramWhy}
                onClick={onReplaceProgram}
              >
                {S.machines.replaceProgram}
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${S.machines.details}: ${machine.alias}`}
          onClick={onToggleOpen}
        >
          <ChevronDown
            size={ICON_SIZE.chevron}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      <div id={detailsId} hidden={!open} className="mt-2 space-y-1 pl-6 text-xs text-gray-500">
        {machine.installed !== null && (
          <p>
            {S.machines.installedAt(
              machine.installed.version,
              formatDateTime(machine.installed.at),
            )}
          </p>
        )}
        {machine.status !== null && (
          <p>{S.machines.checkedAt(formatDateTime(machine.status.checkedAt))}</p>
        )}
        {job !== null && job.log.length > 0 && (
          <details open={reading.kind === "failed"}>
            <summary className="cursor-pointer">{S.machines.output}</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 font-mono text-[11px] whitespace-pre-wrap dark:bg-gray-900">
              {job.log.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}
