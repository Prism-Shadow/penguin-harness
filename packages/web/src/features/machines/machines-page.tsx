/**
 * Machines: the fleet as cards in the Agents list's shape, each one opening the Machine dialog.
 *
 * Enable is the whole of what a person wants from a machine — install or update the program
 * there, start its server, connect, hand over the Model config — as one job the server queues
 * per machine. A card offers it when the machine needs bringing up (Update in its place when the
 * machine carries another build than this server's), beside the gear that configures its ssh
 * host. The Machine dialog holds the rest: the machine's record, its job's output, Disable, which
 * lets a machine go, and the single steps the server also takes one at a time (install, connect,
 * restart, disconnect, remove from the Project).
 *
 * One card per machine, this server first, then the machines in use by name. A card says the
 * state once, as a mark beside the name with its word on hover (machine-card.tsx). While machines
 * in use carry another build, the notice under the title counts them and updates them all at
 * once, after a confirmation.
 *
 * Add machine, at the end of the title row like the other pages' add and import buttons, opens
 * the add dialog (add-machine-dialog.tsx): a host from the ssh config, or a new one by hand. A
 * machine added there has a card at once — enabling, it shows its progress; added only, it offers
 * Enable — and keeps it, a failed first install included, until it is disabled.
 *
 * The page polls while a job is queued or running, and re-probes the servers on a widening
 * schedule (probe-schedule.ts) so a machine that went quiet is noticed without a tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MachineInfo,
  MachinesResponse,
  MachinesUseResponse,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  NoticeStrip,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonCard,
  TodoNotice,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import {
  anyJobPending,
  imageNotice,
  jobFor,
  localMachine,
  machinesInUse,
  updateNotice,
} from "./machines-view";
import { probeDelayMs, probeFingerprint } from "./probe-schedule";
import { SshHostDialog } from "./ssh-host-dialog";
import { AddMachineDialog } from "./add-machine-dialog";
import type { AddedMachines } from "./add-machine-dialog";
import { MachineCard } from "./machine-card";
import { MachineDetailDialog } from "./machine-detail-dialog";
import type { MachineVerb } from "./machine-detail-dialog";

/** How often the page re-reads the list while a job is queued or running. */
const POLL_MS = 1500;

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
  /** The host whose ssh form is open, to configure it; null while closed. */
  const [hostForm, setHostForm] = useState<SshHostResponse | null>(null);
  /** The add dialog is open. */
  const [adding, setAdding] = useState(false);
  /** Moves when that form saves, so an open Machine dialog reads the host block again. */
  const [hostEpoch, setHostEpoch] = useState(0);
  const [pendingVerb, setPendingVerb] = useState<PendingVerb | null>(null);
  /** The machine whose dialog is open, by id; null while none is. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** What the update notice was waved away at (machines-view.ts `updateNotice`). */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

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
  const inUse = useMemo(() => (state === null ? [] : machinesInUse(state)), [state]);
  const local = useMemo(() => (state === null ? null : localMachine(state)), [state]);
  const jobs = useMemo(() => state?.jobs ?? [], [state]);
  const imageVersion = state?.imageVersion ?? null;
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

  /** What the server turned down, by machine, as the page's notice says it; null for nothing. */
  const refusals = (answer: MachinesUseResponse): string | null => {
    if (answer.refused.length === 0) return null;
    const byId = new Map(answer.machines.map((machine) => [machine.id, machine.alias]));
    return answer.refused
      .map(({ machineId, why }) => {
        const alias = byId.get(machineId) ?? machineId;
        if (why === "self") return S.machines.refusedSelf(alias);
        if (why === "no-image") return S.machines.noImage;
        return S.machines.refusedUnknown(alias);
      })
      .join(" ");
  };
  const use = (ids: string[], replaceProgram = false) =>
    post(async (project) => {
      const answer = await api.useMachines(project, ids, replaceProgram);
      const refused = refusals(answer);
      // Set after `post` clears the error, by way of the microtask order: post awaits this, so
      // its setError(null) runs first and this one stands.
      if (refused !== null) queueMicrotask(() => setError(refused));
      return answer;
    });
  /** The add dialog's answer: the list as it now stands, and a word on what happened. */
  const added = ({ state: answer, verb, count }: AddedMachines) => {
    setState(answer);
    const refused = refusals(answer);
    setError(refused);
    const landed = count - answer.refused.length;
    if (landed > 0) {
      toastSuccess(
        verb === "use"
          ? S.machines.addDialog.addedInstalling(landed)
          : S.machines.addDialog.added(landed),
      );
    }
  };
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
      setHostForm(await api.getSshHost(projectId, alias));
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
      case "check":
        // The Machine dialog runs its own connection check.
        return;
      default:
        // The rest interrupt someone or let the machine go: each waits on its confirmation.
        return setPendingVerb({ kind: verb, id: machine.id });
    }
  };

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
          // At the end of the title row, as the Agents and Plugins pages put theirs: the form
          // rung, the primary look, its glyph before its word.
          <Button
            size="sm"
            variant="primary"
            data-action="add-machine"
            disabled={state === null || noImage}
            onClick={() => setAdding(true)}
          >
            <GlyphIcon d={ICONS.plus} size={ICON_SIZE.inlineGlyph} />
            {S.machines.add}
          </Button>
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
        {image?.kind === "buildFailed" && error === null && (
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
      {projectId !== null && state !== null && adding && (
        <AddMachineDialog
          projectId={projectId}
          state={state}
          onClose={() => setAdding(false)}
          onAdded={added}
        />
      )}
      {projectId !== null && hostForm !== null && (
        <SshHostDialog
          key={hostForm.alias}
          host={hostForm}
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
