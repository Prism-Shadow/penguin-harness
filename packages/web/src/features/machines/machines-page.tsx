/**
 * Machines: the fleet as cards in the Agents list's shape, each one opening the Machine dialog.
 *
 * Enable is the whole of what a person wants from a machine — install or update the program
 * there, start its server, connect, hand over the Model config — as one job the server queues
 * per machine. Disable lets a machine go. Both sit on every card (Update in Enable's place when a
 * machine carries another build than this server's), beside the gear that configures its ssh
 * host. The Machine dialog holds the rest: the machine's record, its job's output, and the single
 * steps the server also takes one at a time (install, connect, restart, disconnect, remove from
 * the Project).
 *
 * One card per machine, this server first, then the machines in use by name. A card says the
 * state once, as a mark beside the name with its word on hover (machine-card.tsx). While machines
 * in use carry another build, the notice under the title counts them and updates them all at
 * once, after a confirmation.
 *
 * The page polls while a job is queued or running, and re-probes the servers on a widening
 * schedule (probe-schedule.ts) so a machine that went quiet is noticed without a tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Dropdown,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  NoticeStrip,
  PageFrame,
  PageHeader,
  SearchInput,
  Skeleton,
  SkeletonCard,
  TodoNotice,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk } from "../../lib/tone";
import { NAV_ICONS } from "../../lib/nav-icons";
import {
  anyJobPending,
  installedMachines,
  jobFor,
  localMachine,
  updateNotice,
} from "./machines-view";
import { MAX_VISIBLE_MACHINES, highlightSegments, matchMachines } from "./machines-match";
import { probeDelayMs, probeFingerprint } from "./probe-schedule";
import { SshHostDialog } from "./ssh-host-dialog";
import type { HostFormMode } from "./ssh-host-dialog";
import { MachineCard } from "./machine-card";
import { MachineDetailDialog } from "./machine-detail-dialog";
import type { MachineVerb } from "./machine-detail-dialog";

/** How often the page re-reads the list while a job is queued or running. */
const POLL_MS = 1500;

/** Enable: the plug, cord trailing. */
const PLUG_PATH = ICONS.plug;

/** The expand verb's glyph; turned over when unfolded. */
const CHEVRON_PATH = ICONS.chevronDown;

const MONO = "font-mono text-xs tabular-nums";

/**
 * A verb that interrupts someone or lets something go, waiting on its confirmation: letting a
 * machine go (its connection drops), a forced install (the service there restarts), updating
 * every machine that is behind (each reinstalls and reconnects), dropping a connection every
 * Project using the machine shares, and taking the machine out of this Project.
 */
type PendingVerb =
  | { kind: "stopUsing"; id: string }
  | { kind: "replaceProgram"; id: string }
  | { kind: "updateAll"; ids: string[] }
  | { kind: "disconnect"; id: string }
  | { kind: "release"; id: string };

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
  /** The form that adds a host to the ssh config, or configures one; null while closed. */
  const [hostForm, setHostForm] = useState<HostFormMode | null>(null);
  /** Moves when that form saves, so an open Machine dialog reads the host block again. */
  const [hostEpoch, setHostEpoch] = useState(0);
  const [pendingVerb, setPendingVerb] = useState<PendingVerb | null>(null);
  /** The machine whose dialog is open, by id; null while none is. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** What the update notice was waved away at (machines-view.ts `updateNotice`). */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  /** The picker panel; closing it always clears the query and its picks, so it reopens fresh. */
  const [pickerOpen, setPickerOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<Set<string>>(() => new Set());
  /** Whether the picker shows every match, or the first few with a chevron for the rest. */
  const [showAll, setShowAll] = useState(false);
  const setPickerOpen = (next: boolean) => {
    setPickerOpenState(next);
    if (!next) {
      setQuery("");
      setAdding(new Set());
      setShowAll(false);
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
  const inUseIds = useMemo(() => new Set(inUse.map((machine) => machine.id)), [inUse]);
  const notice = useMemo(
    () => (state === null ? null : updateNotice(state, dismissed)),
    [state, dismissed],
  );
  /** The open dialog's machine: one with a card on this page, or none. */
  const openMachine = useMemo(
    () =>
      openId === null
        ? null
        : ([...(local === null ? [] : [local]), ...inUse].find((m) => m.id === openId) ?? null),
    [openId, local, inUse],
  );
  // A machine that left the list (let go, or taken out of this Project) takes its dialog with it,
  // and does not reopen it should it come back later.
  useEffect(() => {
    if (openId !== null && state !== null && openMachine === null) setOpenId(null);
  }, [openId, state, openMachine]);

  /** Hosts the picker offers: in the config, not this machine, not already in use here. */
  const addable = useMemo(
    () => machines.filter((machine) => !machine.local && !inUseIds.has(machine.id)),
    [machines, inUseIds],
  );
  const matched = useMemo(() => matchMachines(addable, query), [addable, query]);
  const visible = showAll ? matched : matched.slice(0, MAX_VISIBLE_MACHINES);
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
  // The three that let something go — the machine, the connection every Project using it shares,
  // the machine's place in this Project — are reached only through the confirmation below.
  const stopUsing = (id: string) => post((project) => api.stopUsingMachines(project, [id]));
  const disconnect = (id: string) => post((project) => api.disconnectMachine(project, id));
  const release = (id: string) => post((project) => api.releaseMachine(project, id));
  const runPendingVerb = () => {
    const verb = pendingVerb;
    setPendingVerb(null);
    if (verb === null) return;
    if (verb.kind === "stopUsing") void stopUsing(verb.id);
    else if (verb.kind === "replaceProgram") void use([verb.id], true);
    else if (verb.kind === "updateAll") void use(verb.ids);
    else if (verb.kind === "disconnect") void disconnect(verb.id);
    else void release(verb.id);
  };
  const aliasOf = (id: string) => machines.find((machine) => machine.id === id)?.alias ?? id;
  /** The confirmation's verb, body and tone: interrupting work is danger, the update primary. */
  const verbPrompt =
    pendingVerb === null
      ? null
      : pendingVerb.kind === "stopUsing"
        ? {
            label: S.machines.stopUsing,
            body: S.machines.stopUsingOne(aliasOf(pendingVerb.id)),
            tone: "danger" as const,
          }
        : pendingVerb.kind === "replaceProgram"
          ? {
              label: S.machines.replaceProgram,
              body: S.machines.replaceProgramConfirm(aliasOf(pendingVerb.id)),
              tone: "danger" as const,
            }
          : pendingVerb.kind === "disconnect"
            ? {
                label: S.machines.verbs.disconnect,
                body: S.machines.verbs.disconnectConfirm(aliasOf(pendingVerb.id)),
                tone: "danger" as const,
              }
            : pendingVerb.kind === "release"
              ? {
                  label: S.machines.verbs.release,
                  body: S.machines.verbs.releaseConfirm(aliasOf(pendingVerb.id)),
                  tone: "danger" as const,
                }
              : {
                  label: S.machines.updateAll(pendingVerb.ids.length),
                  body: S.machines.updateAllConfirm(pendingVerb.ids.length),
                  tone: "primary" as const,
                };
  const configure = async (alias: string) => {
    if (projectId === null) return;
    try {
      setHostForm({ kind: "edit", host: await api.getSshHost(projectId, alias) });
    } catch (err) {
      toastError(apiErrorText(err));
    }
  };

  /** Every verb a card or the Machine dialog asks for, for one machine. */
  const act = (machine: MachineInfo, verb: MachineVerb) => {
    switch (verb) {
      case "use":
        return void use([machine.id]);
      case "install":
        return void post((project) => api.installOnMachine(project, machine.id));
      case "connect":
        return void post((project) => api.connectMachine(project, machine.id));
      case "restart":
        return void post((project) => api.restartMachine(project, machine.id));
      case "configure":
        return void configure(machine.alias);
      default:
        // The rest interrupt someone or let the machine go: each waits on its confirmation.
        return setPendingVerb({ kind: verb, id: machine.id });
    }
  };

  const toggleAdding = (id: string) => setAdding((prev) => toggled(prev, id));

  const noImage = state !== null && imageVersion === null;

  const card = (machine: MachineInfo) => (
    <MachineCard
      key={machine.id}
      machine={machine}
      job={jobFor(jobs, machine.id)}
      imageVersion={imageVersion}
      locale={locale}
      busy={posting}
      onOpen={() => setOpenId(machine.id)}
      onUse={() => act(machine, "use")}
      onStopUsing={() => act(machine, "stopUsing")}
      onConfigure={() => act(machine, "configure")}
    />
  );

  return (
    <PageFrame>
      {/* The notices belong to the header: they sit under the title, and the list keeps one gap
          below whichever block ends the header. */}
      <PageHeader
        title={S.machines.pageTitle}
        actions={
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
              <SearchInput
                variant="panel"
                autoFocus
                value={query}
                onChange={setQuery}
                placeholder={S.machines.search}
                aria-label={S.machines.search}
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
                      className={`flex w-full min-w-0 items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                        on ? "bg-gray-100 dark:bg-gray-800/60" : ""
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
              {matched.length === 0 && (
                <li className="px-3.5 py-2 text-sm text-gray-400 dark:text-gray-500">
                  {addable.length === 0 ? S.machines.empty : S.machines.noMatch}
                </li>
              )}
            </ul>
            {/* The foot: the rest of the config folded behind a chevron — for when a search
                is the wrong tool and a person wants to see the list — and, at the right, a
                new host for the config. */}
            <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-2 py-1.5 dark:border-gray-800">
              {hiddenCount > 0 || (showAll && matched.length > MAX_VISIBLE_MACHINES) ? (
                <Verb
                  label={showAll ? S.machines.fewer : S.machines.expand}
                  title={showAll ? S.machines.fewer : S.machines.allHosts(hiddenCount)}
                  d={CHEVRON_PATH}
                  glyphClass={showAll ? "rotate-180" : ""}
                  ariaExpanded={showAll}
                  onClick={() => setShowAll((open) => !open)}
                />
              ) : (
                <span />
              )}
              <Verb
                label={S.machines.host.newVerb}
                title={S.machines.host.addTitle}
                d={ICONS.plus}
                onClick={() => {
                  setPickerOpen(false);
                  setHostForm({ kind: "add" });
                }}
              />
            </div>
            {/* The confirm appears once something is picked; an empty footer says nothing. */}
            {adding.size > 0 && (
              <div className="flex justify-end border-t border-gray-200 px-3 py-2 dark:border-gray-800">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={posting}
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
            )}
          </Dropdown>
        }
      >
        {error !== null && (
          <NoticeStrip tone="danger" className="mt-4 rounded-md border px-3 py-2 text-sm">
            {error}
          </NoticeStrip>
        )}
        {noImage && error === null && (
          <NoticeStrip tone="attention" className="mt-4 rounded-md border px-3 py-2 text-sm">
            {S.machines.noImage}
          </NoticeStrip>
        )}
        {/* Machines on another build than this server's, in the one notice shape every page's
            "update all" takes: the count, the update behind a confirmation, and a way to put it
            down while the same machines stay behind. */}
        {notice !== null && (
          <TodoNotice
            text={S.machines.updateNotice(notice.ids.length)}
            actionLabel={S.todo.updateNow}
            busy={posting || pending}
            onAction={() => setPendingVerb({ kind: "updateAll", ids: notice.ids })}
            dismissLabel={S.todo.dismiss}
            onDismiss={() => setDismissed((prev) => new Set([...prev, ...notice.keys]))}
          />
        )}
      </PageHeader>
      {projectId !== null && hostForm !== null && (
        <SshHostDialog
          key={hostForm.kind === "edit" ? hostForm.host.alias : "add"}
          mode={hostForm}
          projectId={projectId}
          onClose={() => setHostForm(null)}
          onSaved={(next) => {
            setState(next);
            setError(null);
            setHostEpoch((epoch) => epoch + 1);
          }}
        />
      )}
      {projectId !== null && openMachine !== null && (
        <MachineDetailDialog
          projectId={projectId}
          hostEpoch={hostEpoch}
          machine={openMachine}
          job={jobFor(jobs, openMachine.id)}
          imageVersion={imageVersion}
          locale={locale}
          error={error}
          busy={posting}
          noImage={noImage}
          onAct={(verb) => act(openMachine, verb)}
          onClose={() => setOpenId(null)}
        />
      )}
      {/* Every verb that asks first — the notice's update of all of them included — opens this
          one confirmation by setting `pendingVerb`, and only its confirm runs the verb. */}
      {pendingVerb !== null && verbPrompt !== null && (
        <ConfirmModal
          open
          title={verbPrompt.label}
          tone={verbPrompt.tone}
          onClose={() => setPendingVerb(null)}
          onConfirm={runPendingVerb}
          confirmLabel={verbPrompt.label}
          cancelLabel={S.common.cancel}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">{verbPrompt.body}</p>
        </ConfirmModal>
      )}

      {state === null ? (
        // A refusal (the page is an admin's) or a failed read says so above, with nothing below
        // pretending to load.
        error === null && (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonCard key={i} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <div className="min-w-[14rem] flex-1">
                  <Skeleton className="h-[18px] w-40" />
                  <Skeleton className="mt-1.5 h-4 w-2/3" />
                  <Skeleton className="mt-1.5 h-4 w-48" />
                </div>
                <Skeleton className="h-8 w-40" />
              </SkeletonCard>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {local !== null && card(local)}
          {inUse.map(card)}
          {inUse.length === 0 && (
            <EmptyState title={S.machines.noneInUse} description={S.machines.sshHint} />
          )}
        </div>
      )}
    </PageFrame>
  );
}

/**
 * The picker foot's verbs — show the rest of the config, and a new ssh host — in one shape: a
 * small secondary button carrying one glyph and the word beside it. The glyph says which verb,
 * the word confirms it.
 */
function Verb({
  label,
  d,
  onClick,
  title,
  glyphClass = "",
  ariaExpanded,
}: {
  label: string;
  d: string;
  onClick: () => void;
  title?: string;
  glyphClass?: string;
  ariaExpanded?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      title={title ?? label}
      aria-expanded={ariaExpanded}
      className="whitespace-nowrap"
      onClick={onClick}
    >
      <GlyphIcon d={d} size={ICON_SIZE.inlineGlyph} className={glyphClass} />
      {label}
    </Button>
  );
}
