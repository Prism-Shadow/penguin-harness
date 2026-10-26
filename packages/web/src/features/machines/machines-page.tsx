/**
 * Machines: the fleet as cards in the Agents list's shape, each one opening the Machine dialog.
 *
 * A card's quick buttons are the Agents card's: Use starts a new conversation in the machine's
 * temporary workspace, Settings opens the Machine dialog, Delete takes the machine off this
 * Project — after a confirmation that says plainly what happens: the connection drops, and the
 * program and its data stay on the machine, its host in the ssh config. A connected machine on
 * this server's build also has Sync config, which hands it this Project's config now. The Machine
 * dialog holds every other verb in one toolbar (machine-detail-dialog.tsx): Enable or Update, Stop
 * or Start its server, Restart it, Sync config, Configure SSH, Uninstall. While the server brings a
 * machine back, or after it stopped trying, the card's middle and the dialog show the shared retry
 * status, with its Retry.
 *
 * One card per machine, this server first, then the machines in use by name. A card says the
 * state once, as a labelled pill beside the name with the reason on hover (machine-card.tsx). While machines
 * in use carry another build, the notice under the title counts them and updates them all at
 * once, after a confirmation.
 *
 * Add machine, at the end of the title row like the other pages' add and import buttons, opens
 * the add dialog (add-machine-dialog.tsx): a host from the ssh config, or a new one by hand. A
 * machine added there has a card at once — enabling, it shows its progress; added only, its
 * dialog offers Enable — and keeps it, a failed first install included, until it is deleted.
 *
 * The list is the one live account of the machines (state/machines.tsx): the server says when
 * it changed and the page reads it again, so a job's steps advance as they happen. While a job is
 * on its way the page also reads it every few seconds, in case a word from the server was lost.
 * The servers are re-probed on a widening schedule (probe-schedule.ts) so a machine that went
 * quiet is noticed without a tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  MachineInfo,
  MachinesResponse,
  MachinesUseResponse,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Checkbox,
  ConfirmModal,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  MachineList,
  NoticeStrip,
  PageFrame,
  PageHeader,
  TodoNotice,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";
import { useMachines } from "../../state/machines";
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
import { programDirOf } from "./machine-detail-view";

/** While a job is on its way, the page reads the list this often too: a net under the server's word. */
const FALLBACK_POLL_MS = 5_000;

const MONO = "font-mono text-xs tabular-nums";

/**
 * A verb that stops or removes something, waiting on its confirmation: deleting a machine from
 * the Project, stopping its server, uninstalling the program, a forced install (the server there
 * restarts), and updating every machine that is behind (each reinstalls and reconnects).
 */
type PendingVerb =
  | { kind: "delete"; id: string }
  | { kind: "stop"; id: string }
  | { kind: "uninstall"; id: string }
  | { kind: "replaceProgram"; id: string }
  | { kind: "updateAll"; ids: string[] };

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
  /** The host whose ssh form is open, to configure it; null while closed. */
  const [hostForm, setHostForm] = useState<SshHostResponse | null>(null);
  /** The add dialog is open. */
  const [adding, setAdding] = useState(false);
  /** Moves when that form saves, so an open Machine dialog reads the host block again. */
  const [hostEpoch, setHostEpoch] = useState(0);
  const [pendingVerb, setPendingVerb] = useState<PendingVerb | null>(null);
  /** The uninstall confirmation's box: the data directory goes too. Off each time it opens. */
  const [removeData, setRemoveData] = useState(false);
  /** The machine whose dialog is open, by id; null while none is. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** What the update notice was waved away at (machines-view.ts `updateNotice`). */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

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
  // A machine that left the list (deleted) takes its dialog with it, and does not reopen it
  // should it come back later.
  useEffect(() => {
    if (openId !== null && state !== null && openMachine === null) setOpenId(null);
  }, [openId, state, openMachine]);

  /**
   * Re-probe the servers in use on a widening schedule. Separate from the server's own word on
   * the list: that one follows jobs and connections, this one watches the servers nobody is
   * touching and has to stay cheap for hours.
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
    accept(answer);
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
  // The three that stop or remove something — the machine's place in this Project, its server,
  // its program — are reached only through the confirmation below.
  const deleteMachine = (id: string) => post((project) => api.stopUsingMachines(project, [id]));
  const stopServer = (id: string) => post((project) => api.stopMachine(project, id));
  const uninstall = (id: string, withData: boolean) =>
    post((project) => api.uninstallMachine(project, id, withData));
  const runPendingVerb = () => {
    const verb = pendingVerb;
    setPendingVerb(null);
    if (verb === null) return;
    if (verb.kind === "delete") void deleteMachine(verb.id);
    else if (verb.kind === "stop") void stopServer(verb.id);
    else if (verb.kind === "uninstall") void uninstall(verb.id, removeData);
    else if (verb.kind === "replaceProgram") void use([verb.id], true);
    else void use(verb.ids);
  };
  const machineOf = (id: string) => machines.find((machine) => machine.id === id);
  const aliasOf = (id: string) => machineOf(id)?.alias ?? id;
  const c = S.machines.confirm;
  /** The confirmation's title, verb, body and tone: stopping or removing is danger, an update primary. */
  const verbPrompt = (() => {
    if (pendingVerb === null) return null;
    switch (pendingVerb.kind) {
      case "delete":
        return {
          title: c.deleteTitle(aliasOf(pendingVerb.id)),
          label: S.machines.card.delete,
          body: c.deleteBody(
            aliasOf(pendingVerb.id),
            machineOf(pendingVerb.id)?.passwordSaved === true,
          ),
          tone: "danger" as const,
        };
      case "stop":
        return {
          title: c.stopTitle(aliasOf(pendingVerb.id)),
          label: S.machines.detail.toolbar.stop,
          body: c.stopBody,
          tone: "danger" as const,
        };
      case "uninstall":
        return {
          title: c.uninstallTitle(aliasOf(pendingVerb.id)),
          label: S.machines.detail.toolbar.uninstall,
          body: c.uninstallBody(programDirOf(machineOf(pendingVerb.id)?.root ?? "")),
          tone: "danger" as const,
        };
      case "replaceProgram":
        return {
          title: S.machines.replaceProgram,
          label: S.machines.replaceProgram,
          body: S.machines.replaceProgramConfirm(aliasOf(pendingVerb.id)),
          tone: "danger" as const,
        };
      case "updateAll":
        return {
          title: S.machines.updateAll(pendingVerb.ids.length),
          label: S.machines.updateAll(pendingVerb.ids.length),
          body: S.machines.updateAllConfirm(pendingVerb.ids.length),
          tone: "primary" as const,
        };
    }
  })();
  const configure = async (alias: string) => {
    if (projectId === null) return;
    try {
      setHostForm(await api.getSshHost(projectId, alias));
    } catch (err) {
      toastError(apiErrorText(err));
    }
  };
  /**
   * A new conversation in the machine's temporary workspace — the new-chat page's own draft, its
   * workspace set to the temporary one there, the machine's own default Agent picked by it; this
   * server's card starts one here.
   */
  const startChat = (machine: MachineInfo) =>
    navigate("/chat/new", {
      state:
        machine.local || machine.machineId === null
          ? { workspace: "" }
          : { workspace: "", machineId: machine.machineId },
    });

  /** Every verb the Machine dialog asks for, for one machine. */
  const act = (machine: MachineInfo, verb: MachineVerb) => {
    switch (verb) {
      case "use":
        return void use([machine.id]);
      case "start":
        return void post((project) => api.connectMachine(project, machine.id));
      case "restart":
        return void post((project) => api.restartMachine(project, machine.id));
      case "syncConfig":
        return void post((project) => api.syncMachineConfig(project, machine.id));
      case "configure":
        return void configure(machine.alias);
      case "reconnect":
        return retryReconnect(machine);
      case "uninstall":
        setRemoveData(false);
        return setPendingVerb({ kind: "uninstall", id: machine.id });
      default:
        // Stopping its server and a forced install interrupt someone: each waits on its confirmation.
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
      onUse={() => startChat(machine)}
      onSyncConfig={() => void post((project) => api.syncMachineConfig(project, machine.id))}
      onDelete={() => setPendingVerb({ kind: "delete", id: machine.id })}
      onRetry={() => retryReconnect(machine)}
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
          title={verbPrompt.title}
          tone={verbPrompt.tone}
          onClose={() => setPendingVerb(null)}
          onConfirm={runPendingVerb}
          confirmLabel={verbPrompt.label}
          cancelLabel={S.common.cancel}
        >
          <p className="text-sm font-medium">{verbPrompt.title}</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{verbPrompt.body}</p>
          {/* An uninstall keeps the machine's data unless asked: the box says where it lives. */}
          {pendingVerb.kind === "uninstall" && (
            <Checkbox
              className="mt-3"
              data-field="removeData"
              checked={removeData}
              onChange={setRemoveData}
              label={S.machines.confirm.removeData}
              hint={
                <>
                  <span className={`block break-all ${MONO}`}>
                    {machineOf(pendingVerb.id)?.root ?? ""}
                  </span>
                  <span className="block">{S.machines.confirm.removeDataWarning}</span>
                </>
              }
            />
          )}
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
