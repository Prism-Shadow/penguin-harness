/**
 * Machines page: pick a host out of the SERVER's own `~/.ssh/config` and install this build
 * on it.
 *
 * The host list is a PICKER, not a rendered list, because an ssh config routinely declares
 * hundreds of entries: the panel shows a few rows, a fuzzy query reaches the rest, and the
 * matched characters are highlighted so a subsequence hit (`gpu1` → `gpu-01`) reads as a
 * match rather than as a wrong result. A counter names how many rows the current view leaves
 * out — silent truncation would read as "that host is not in my config".
 *
 * The list itself is the config text; the server does no `ssh -G` and no network to produce
 * it, so hundreds of hosts cost one file read and a row carries nothing but its alias.
 *
 * An install is a job on the server, not a request that finishes: it probes the machine,
 * may fetch a Node runtime, copies an image over scp and runs an installer there. POST
 * starts it and the page polls while it runs. The progress lines are the far side's own
 * words wherever there are any, so they are rendered verbatim in a monospace block rather
 * than interpreted here — a refused key or an unusable Node explains itself better than any
 * status enum could.
 *
 * One job exists at a time server-side, so the panel below follows THE JOB and names the
 * alias it belongs to, while the button follows the SELECTION: picking another host while
 * one installs must not hide the install that is running.
 *
 * Which hosts already carry this program comes from each machine's own persisted record,
 * not from the job — the job is one slot, so reading "installed" off it made a host stop
 * looking installed the moment anything else was installed or the server restarted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatDateTime } from "../../lib/format";
import { toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { InfoPopover } from "../../components/ui/info-popover";
import { Skeleton } from "../../components/ui/skeleton";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ChevronDown, NAV_ICONS } from "../../components/ui/icons";
import {
  activeMachine,
  connectAction,
  installButtonState,
  installedMachines,
  localMachine,
  statusTone,
  verdictOf,
} from "./machines-view";
import type { MachineVerdict } from "./machines-view";
import { MAX_VISIBLE_MACHINES, highlightSegments, matchMachines } from "./machines-match";
import { probeDelayMs, probeFingerprint } from "./probe-schedule";
import { activeServerId, setActiveServer } from "../../lib/server-context";

/** How often a running job is re-read. Slow enough to be free, fast enough that a step reads as progress. */
const POLL_MS = 1500;

/** One machine's server state as a line of text, or null when it has not been probed yet. */
function statusText(machine: MachineInfo): string | null {
  const status = machine.status;
  if (status === null) return null;
  if (status.state === "running") {
    return status.port === undefined
      ? S.machines.statusRunning
      : S.machines.statusRunningOn(status.port);
  }
  return status.state === "stopped" ? S.machines.statusStopped : S.machines.statusUnreachable;
}

/** A finished job's one-line verdict, and the tone that carries it. */
function verdictLine(verdict: MachineVerdict): { text: string; tone: Tone } {
  if (verdict.kind === "failed") {
    return { text: S.machines.failedAt(verdict.step), tone: "danger" };
  }
  const version = verdict.version ?? "";
  return {
    text:
      verdict.kind === "already-installed"
        ? S.machines.alreadyInstalled(version)
        : S.machines.installed(version),
    tone: "success",
  };
}

export function MachinesPage() {
  useDocumentTitle(S.machines.pageTitle);
  const [state, setState] = useState<MachinesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True while a POST has not come back yet — the server has no job to report in that window. */
  const [starting, setStarting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** The picker panel; closing it always clears the query, so it reopens unfiltered. */
  const [pickerOpen, setPickerOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const setPickerOpen = (open: boolean) => {
    setPickerOpenState(open);
    if (!open) setQuery("");
  };

  const load = useCallback(async () => {
    try {
      setState(await api.getMachines());
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a job runs. Chained timeouts rather than an interval: a slow response
  // must not stack requests behind itself.
  const running = state?.job?.running === true || state?.connect?.running === true;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!running) return;
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
  }, [running]);

  const machines = useMemo(() => state?.machines ?? [], [state]);
  const installed = useMemo(() => (state === null ? [] : installedMachines(state)), [state]);
  const local = useMemo(() => (state === null ? null : localMachine(state)), [state]);
  /** Which server this window is talking to right now (null = the local one). */
  const activeId = activeServerId();
  const active = useMemo(
    () => (state === null ? null : activeMachine(state, activeId)),
    [state, activeId],
  );
  /** The machine whose connect POST is in flight — the server has no job to report yet. */
  const [connecting, setConnecting] = useState<string | null>(null);
  /** Aliases the picker offers: everything except this machine, which is not a target. */
  const pickable = useMemo(() => machines.filter((machine) => !machine.local), [machines]);
  const matched = useMemo(() => matchMachines(pickable, query), [pickable, query]);
  const visible = matched.slice(0, MAX_VISIBLE_MACHINES);
  const hiddenCount = matched.length - visible.length;
  const selected = machines.find((machine) => machine.id === selectedId) ?? null;

  /**
   * Re-probe the installed servers on a widening schedule (probe-schedule.ts). Separate from
   * the job poll above: that one follows an install and stops when it settles, this one
   * watches machines nobody is touching and has to stay cheap for hours.
   */
  const [probing, setProbing] = useState(false);
  const settledRounds = useRef(0);
  const lastPrint = useRef<string | null>(null);
  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const next = await api.probeMachines();
      const print = probeFingerprint(next.machines);
      // A round that changed nothing widens the interval; anything moving resets it.
      settledRounds.current = print === lastPrint.current ? settledRounds.current + 1 : 0;
      lastPrint.current = print;
      setState(next);
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setProbing(false);
    }
  }, []);

  const probeRef = useRef(probe);
  probeRef.current = probe;
  /** Nothing installed anywhere: there is no server to ask about, so no timer runs at all. */
  const hasInstalled = installed.length > 0;
  useEffect(() => {
    if (!hasInstalled) return;
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
  }, [hasInstalled]);

  /**
   * Points this window at a server. A full document load, not a state update: none of one
   * server's in-memory state — sessions, streams, caches — may survive into another's.
   */
  const enterServer = (machineId: string | null) => {
    setActiveServer(machineId);
    window.location.assign("/");
  };

  const connect = async (machineId: string) => {
    setConnecting(machineId);
    try {
      setState(await api.connectMachine(machineId));
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setConnecting(null);
    }
  };

  const disconnect = async (machineId: string) => {
    try {
      setState(await api.disconnectMachine(machineId));
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  };

  const install = async () => {
    if (selectedId === null) return;
    setStarting(true);
    try {
      setState(await api.installOnMachine(selectedId));
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setStarting(false);
    }
  };

  const job = state?.job ?? null;
  const verdict = job === null ? null : verdictOf(job);
  const verdictText = verdict === null ? null : verdictLine(verdict);
  const button =
    state === null
      ? { action: "install" as const, disabled: true }
      : installButtonState(selected, state, starting);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">
          {S.machines.pageTitle}
          <InfoPopover label={S.machines.pageTitle}>{S.machines.pageDesc}</InfoPopover>
        </h1>

        {error !== null && (
          <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
            {error}
          </div>
        )}

        {state === null ? (
          <div className="mt-6 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <>
            {state.imageVersion === null ? (
              <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.attention}`}>
                {S.machines.noImage}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {S.machines.imageVersion(state.imageVersion)}
              </p>
            )}

            {machines.length === 0 ? (
              <EmptyState title={S.machines.empty} />
            ) : (
              <div className="mt-6 flex items-start gap-2">
                {/* The picker. Fuzzy query over the aliases, matched characters bright and
                    the rest dimmed — with a subsequence match, an unmarked row looks wrong. */}
                <Dropdown
                  open={pickerOpen}
                  setOpen={setPickerOpen}
                  className="min-w-0 flex-1"
                  menuClass="left-0 right-0 top-full mt-1 origin-top"
                  button={
                    <button
                      type="button"
                      onClick={() => setPickerOpen(!pickerOpen)}
                      aria-haspopup="listbox"
                      aria-expanded={pickerOpen}
                      className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                    >
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">
                        <GlyphIcon d={NAV_ICONS.machines} size={ICON_SIZE.rowLead} />
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${selected === null ? "text-gray-400 dark:text-gray-500" : ""}`}
                      >
                        {selected?.alias ?? S.machines.pick}
                      </span>
                      <ChevronDown className="shrink-0 text-gray-400" />
                    </button>
                  }
                >
                  {machines.length > MAX_VISIBLE_MACHINES && (
                    <div className="px-2 pt-1 pb-1">
                      <input
                        type="search"
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={S.machines.search}
                        aria-label={S.machines.search}
                        className="w-full rounded-md border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-gray-400 focus:border-gray-400 dark:border-gray-700 dark:placeholder:text-gray-500 dark:focus:border-gray-500"
                      />
                    </div>
                  )}
                  {visible.map(({ machine, positions }) => (
                    <button
                      key={machine.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(machine.id);
                        setPickerOpen(false);
                      }}
                      className="flex w-full min-w-0 items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
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
                      {/* Which hosts already carry this program — the version, not a bare
                          tick, because a stale one is the reason to reinstall. */}
                      {machine.installed !== null && (
                        <span className={`shrink-0 text-xs ${toneInk.success}`}>
                          {machine.installed.version}
                        </span>
                      )}
                    </button>
                  ))}
                  {visible.length === 0 && (
                    <p className="px-3.5 py-2 text-sm text-gray-400 dark:text-gray-500">
                      {S.machines.noMatch}
                    </p>
                  )}
                  {hiddenCount > 0 && (
                    <p className="px-3.5 pt-1 pb-1.5 text-xs text-gray-400 dark:text-gray-500">
                      {S.machines.more(hiddenCount)}
                    </p>
                  )}
                </Dropdown>
                <Button
                  variant="primary"
                  disabled={button.disabled}
                  onClick={() => void install()}
                  className="shrink-0"
                >
                  {button.action === "installing"
                    ? S.machines.installing
                    : button.action === "reinstall"
                      ? S.machines.reinstall
                      : S.machines.install}
                </Button>
              </div>
            )}

            {selected?.installed != null && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {S.machines.installedAt(
                  selected.installed.version,
                  formatDateTime(selected.installed.at),
                )}
              </p>
            )}

            {/* This machine, first and on its own: it is where the page is being served
                from, always up by definition, and never something to install onto. */}
            {local !== null && (
              <section className="mt-6">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  {S.machines.localTitle}
                </h2>
                <div className="mt-2 flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900">
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">
                    <GlyphIcon d={NAV_ICONS.machines} size={ICON_SIZE.rowLead} />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    title={local.machineId ?? undefined}
                  >
                    {local.alias}
                  </span>
                  {local.installed !== null && (
                    <span className={`shrink-0 text-xs ${toneInk.success}`}>
                      {local.installed.version}
                    </span>
                  )}
                  <span className={`shrink-0 text-xs ${toneInk[statusTone(local.status?.state)]}`}>
                    {statusText(local) ?? S.machines.statusRunning}
                  </span>
                </div>
              </section>
            )}

            {/* What this server has already installed, standing on the page rather than
                only inside the picker: it is the answer to "what did I do", which a panel
                that has to be opened one row at a time cannot give. */}
            {installed.length > 0 && (
              <section className="mt-6">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
                    {S.machines.installedTitle(installed.length)}
                  </h2>
                  {/* The schedule widens on its own (probe-schedule.ts); this is for when
                      you already know something changed and do not want to wait for it. */}
                  <Button size="sm" variant="ghost" disabled={probing} onClick={() => void probe()}>
                    {probing ? S.machines.checking : S.machines.refresh}
                  </Button>
                </div>
                <div className="mt-2 divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {installed.map((machine) => {
                    const action = connectAction(machine, state.connect, connecting);
                    const isActive = active?.id === machine.id;
                    return (
                      <div
                        key={machine.id}
                        className={`flex min-w-0 items-center gap-3 px-3 py-2.5 ${
                          machine.id === selectedId
                            ? "bg-gray-100 dark:bg-gray-800"
                            : "bg-white dark:bg-gray-900"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(machine.id)}
                          aria-current={machine.id === selectedId ? "true" : undefined}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="shrink-0 text-gray-500 dark:text-gray-400">
                            <GlyphIcon d={NAV_ICONS.machines} size={ICON_SIZE.rowLead} />
                          </span>
                          {/* The alias is the label — it is what someone chose and recognises.
                          The machine's own id is the identity, kept to the tooltip. */}
                          <span
                            className="min-w-0 flex-1 truncate text-sm font-medium"
                            title={machine.machineId ?? undefined}
                          >
                            {machine.alias}
                          </span>
                          <span className={`shrink-0 text-xs ${toneInk.success}`}>
                            {machine.installed!.version}
                          </span>
                          {/* The server over there, as of the last probe. Never colour alone:
                          the state is named in words, and unprobed says so too. */}
                          <span
                            className={`shrink-0 text-xs ${statusText(machine) === null ? "text-gray-400 dark:text-gray-500" : toneInk[statusTone(machine.status?.state)]}`}
                            title={machine.status?.detail}
                          >
                            {statusText(machine) ?? S.machines.statusUnknown}
                          </span>
                        </button>
                        {/* Connecting is what makes a machine reachable; entering it is what
                          points this window at it. Two steps on purpose: a tunnel can be up
                          without the window following it. */}
                        {action === "connected" ? (
                          <>
                            {isActive ? (
                              <span className={`shrink-0 text-xs ${toneInk.busy}`}>
                                {S.machines.hereNow}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => enterServer(machine.machineId)}
                                disabled={machine.machineId === null}
                              >
                                {S.machines.enter}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void disconnect(machine.id)}
                            >
                              {S.machines.disconnect}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={action !== "connect" || state.connect?.running === true}
                            onClick={() => void connect(machine.id)}
                          >
                            {action === "connecting" ? S.machines.connecting : S.machines.connect}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* The job, whichever machine it belongs to — named, so a selection change
                while one runs never leaves an unattributed log on screen. */}
            {job !== null && (
              <section className="mt-5 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 dark:bg-gray-900">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.alias}</span>
                  {running ? (
                    <span className={`text-xs ${toneInk.busy}`}>{S.machines.installing}</span>
                  ) : (
                    verdictText !== null && (
                      <span className={`text-xs ${toneInk[verdictText.tone]}`}>
                        {verdictText.text}
                      </span>
                    )
                  )}
                </div>
                {job.log.length > 0 && (
                  <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {S.machines.output}
                    </p>
                    <pre className="mt-1 max-h-64 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                      {job.log.join("\n")}
                    </pre>
                    {verdict?.kind === "failed" && (
                      <pre
                        className={`mt-2 font-mono text-xs break-words whitespace-pre-wrap ${toneInk.danger}`}
                      >
                        {verdict.message}
                      </pre>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
