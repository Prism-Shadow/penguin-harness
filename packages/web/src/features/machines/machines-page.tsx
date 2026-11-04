/**
 * Machines: the fleet as cards in the Agents list's shape, each one opening the Machine dialog.
 *
 * Enable is the whole of what a person wants from a machine — install or update the program
 * there, start its server, connect, hand over the Model config — as one job the server queues
 * per machine. A card offers it when the machine needs bringing up (Update in its place when the
 * machine carries another build than this server's), beside the gear that opens its kind's own
 * form; a connected machine on this server's build also has Sync config, which hands it this
 * Project's config now. The Machine dialog holds the rest: the machine's record, its job's
 * output, and the single steps and the ways out the server also takes one at a time (install,
 * connect, restart, disconnect, remove from the Project).
 *
 * One card per machine, this server first, then the machines in use by name. A card says the
 * state once, as a labelled pill beside the name with the reason on hover (machine-card.tsx). While machines
 * in use carry another build, the notice under the title counts them and updates them all at
 * once, after a confirmation.
 *
 * Machines are of KINDS the server's plugins contribute (ssh, WSL, a container): the page knows
 * none of them. The + and the gear draw each kind's own form (machine-definition-dialog.tsx);
 * a card whose kind is not loaded here says so and offers nothing to do.
 *
 * The list is the one live account of the machines (state/machines.tsx): the server says when
 * it changed and the page reads it again, so a job's steps advance as they happen. While a job
 * is on its way the page also reads it every few seconds, in case a word from the server was
 * lost. The servers are re-probed on a widening schedule (probe-schedule.ts) so a machine that
 * went quiet is noticed without a tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  MachineInfo,
  MachineKindInfo,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Dropdown,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  MachineList,
  NoticeStrip,
  PageFrame,
  PageHeader,
  SearchInput,
  Skeleton,
  SkeletonCard,
  TodoNotice,
  toastError,
} from "@prismshadow/penguin-ui";
import { toastApiError } from "../../lib/toast-api-error";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";
import { useMachines } from "../../state/machines";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk } from "../../lib/tone";
import { NAV_ICONS } from "../../lib/nav-icons";
import {
  anyJobPending,
  imageNotice,
  jobFor,
  localMachine,
  machinesInUse,
  updateNotice,
} from "./machines-view";
import { MAX_VISIBLE_MACHINES, highlightSegments, matchMachines } from "./machines-match";
import { probeDelayMs, probeFingerprint } from "./probe-schedule";
import { MachineDefinitionDialog } from "./machine-definition-dialog";
import type { DefinitionFormMode } from "./machine-definition-dialog";
import { localizedText } from "../chat/skill-use";
import { MachineCard } from "./machine-card";
import { MachineDetailDialog } from "./machine-detail-dialog";
import type { MachineVerb } from "./machine-detail-dialog";

/** While a job is on its way, the page reads the list this often too: a net under the server's word. */
const FALLBACK_POLL_MS = 5_000;

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
  const navigate = useNavigate();
  // Machines belong to the Project, like every other row in this nav group: switching
  // Projects switches which machines are listed, and enabling one here gives the machine to
  // THIS Project — the same one whose Model credentials it will be handed.
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const account = useMachines();
  const state = account.state;
  const { accept, refresh } = account;
  /** What the last request from this page answered with when it failed; the list's own read error otherwise. */
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? account.error;
  /** True while a POST has not come back yet. */
  const [posting, setPosting] = useState(false);
  const [definitionForm, setDefinitionForm] = useState<DefinitionFormMode | null>(null);
  /** Moves when a definition form saves, so an open Machine dialog reads the host block again. */
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

  // While a job is on its way the server tells the page of every step; a word lost on the way
  // (a stream reconnecting) is caught by reading the list every few seconds meanwhile.
  const pending = state !== null && anyJobPending(state);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const machines = useMemo(() => state?.machines ?? [], [state]);
  const inUse = useMemo(() => (state === null ? [] : machinesInUse(state)), [state]);
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

  const kinds = useMemo(() => state?.kinds ?? [], [state]);
  const kindOf = (machine: MachineInfo): MachineKindInfo | null =>
    kinds.find((k) => k.kind === machine.kind) ?? null;
  const kindTitle = (machine: MachineInfo): string => {
    const kind = kindOf(machine);
    return kind === null ? machine.kind : localizedText(locale, kind.title, kind.titleZh);
  };
  /** More than one kind loaded: the picker says which each row is. */
  const severalKinds = kinds.length > 1;
  const definable = kinds.some((k) => k.form !== null);
  /** Machines the picker offers: listed by a loaded kind, not this machine, not already in use here. */
  const addable = useMemo(
    () =>
      machines.filter(
        (machine) =>
          !machine.local && machine.unavailable === undefined && !inUseIds.has(machine.id),
      ),
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
      accept(next);
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, [projectId, accept]);

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

  /** Sends a verb and takes the list it answers with; true when the server took it. */
  const post = async (run: (projectId: string) => Promise<MachinesResponse>): Promise<boolean> => {
    if (projectId === null) return false;
    setPosting(true);
    try {
      accept(await run(projectId));
      setError(null);
      return true;
    } catch (err) {
      setError(apiErrorText(err));
      return false;
    } finally {
      setPosting(false);
    }
  };
  /**
   * Retry while the server brings a machine back. A refusal is said in the page's notice and
   * rejects, so the retry status lets the press be made again.
   */
  const retryReconnect = async (machine: MachineInfo): Promise<void> => {
    if (!(await post((project) => api.reconnectMachine(project, machine.id)))) {
      throw new Error("The server did not take the retry.");
    }
  };
  /** Stop retrying, the same way: a failed request is said, and the press can be made again. */
  const stopReconnecting = async (machine: MachineInfo): Promise<void> => {
    if (!(await post((project) => api.stopReconnectingMachine(project, machine.id)))) {
      throw new Error("The server did not take the stop.");
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
                if (why === "kind-unavailable") return S.machines.refusedKind(alias);
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
  const configure = async (machine: MachineInfo) => {
    if (projectId === null) return;
    try {
      setDefinitionForm({
        kind: "edit",
        machineKind: machine.kind,
        definition: await api.getMachineDefinition(projectId, machine.kind, machine.alias),
      });
    } catch (err) {
      toastApiError(err);
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
        return void configure(machine);
      default:
        // The rest interrupt someone or let the machine go: each waits on its confirmation.
        return setPendingVerb({ kind: verb, id: machine.id });
    }
  };

  const toggleAdding = (id: string) => setAdding((prev) => toggled(prev, id));

  const image = state === null ? null : imageNotice(state);
  const noImage = image?.kind === "noImage";

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
      kindTitle={kindTitle(machine)}
      onConfigure={
        machine.unavailable === undefined && kindOf(machine)?.form != null
          ? () => act(machine, "configure")
          : null
      }
      onSyncConfig={() => void post((project) => api.syncMachineConfig(project, machine.id))}
      onPorts={
        machine.local || machine.machineId === null
          ? null
          : () => navigate(`/machines/${encodeURIComponent(machine.machineId!)}/ports`)
      }
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
                disabled={state === null || (addable.length === 0 && !definable) || noImage}
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
                      {severalKinds && (
                        <span className="shrink-0 text-xs text-fg-muted">{kindTitle(machine)}</span>
                      )}
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
              {definable && (
                <Verb
                  label={S.machines.definition.newVerb}
                  title={S.machines.definition.newTitle}
                  d={ICONS.plus}
                  onClick={() => {
                    setPickerOpen(false);
                    setDefinitionForm({ kind: "add" });
                  }}
                />
              )}
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
        {shownError !== null && (
          <NoticeStrip tone="danger" className="mt-4 rounded-md border px-3 py-2 text-sm">
            {shownError}
          </NoticeStrip>
        )}
        {noImage && shownError === null && (
          <NoticeStrip tone="attention" className="mt-4 rounded-md border px-3 py-2 text-sm">
            {S.machines.noImage}
          </NoticeStrip>
        )}
        {image?.kind === "buildFailed" && shownError === null && (
          <NoticeStrip tone="attention" className="mt-4 rounded-md border px-3 py-2 text-sm">
            <p>{S.machines.checkoutImageFailed}</p>
            {/* The build's own last lines: where pnpm, vite or the packer said what went wrong. */}
            <pre className={`mt-1 break-words whitespace-pre-wrap ${MONO}`}>{image.detail}</pre>
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
      {projectId !== null && definitionForm !== null && (
        <MachineDefinitionDialog
          key={
            definitionForm.kind === "edit"
              ? `${definitionForm.machineKind}:${definitionForm.definition.name}`
              : "add"
          }
          mode={definitionForm}
          kinds={kinds}
          projectId={projectId}
          onClose={() => setDefinitionForm(null)}
          onSaved={(next) => {
            accept(next);
            setError(null);
            setHostEpoch((epoch) => epoch + 1);
          }}
        />
      )}
      {projectId !== null && openMachine !== null && (
        <MachineDetailDialog
          projectId={projectId}
          hostEpoch={hostEpoch}
          canConfigure={kindOf(openMachine)?.form != null}
          machine={openMachine}
          job={jobFor(jobs, openMachine.id)}
          imageVersion={imageVersion}
          locale={locale}
          error={shownError}
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
        error === null && <MachineList loading />
      ) : (
        <MachineList
          empty={
            inUse.length === 0 ? (
              <EmptyState title={S.machines.noneInUse} description={S.machines.sshHint} />
            ) : null
          }
        >
          {local !== null && card(local)}
          {inUse.map(card)}
        </MachineList>
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
