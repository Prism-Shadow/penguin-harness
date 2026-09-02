/**
 * The live update flow: the store behind the update modal, the account-menu row and the
 * version-line badge, and the actions they call. `update-flow.ts` holds the pure state
 * machine; this file feeds it from the shared caches (`use-version-info.ts` for the server
 * release, `use-desktop-update.ts` for the shell's snapshot) and runs the requests.
 *
 * Everything the flow adds of its own is module level (a zustand vanilla store): the modal
 * may be closed mid-download and reopened from another surface, and the outcome of a
 * request has to reach the user wherever they are — in the modal when it is open, as a
 * toast otherwise. One owner drives the polling and the toasts: `useUpdateFlowOwner`,
 * mounted once by the modal in the app layout. Every other consumer is passive
 * (`useUpdateFlow`), reading the same stores through subscriptions.
 */
import { useEffect, useRef } from "react";
import { createStore, useStore } from "zustand";
import type { UpdateJobStatus } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { S } from "./strings";
import { apiErrorText } from "./api-error";
import { toastError, toastInfo, toastSuccess } from "../components/ui/toast";
import {
  clientFlow,
  opensWithCheck,
  releaseFlow,
  updateModeFor,
  type FlowLocal,
  type UpdateFlow,
  type UpdateMode,
} from "./update-flow";
import {
  forceUpdateCheck,
  getVersionInfo,
  updateCheckOutcome,
  useVersionInfo,
} from "./use-version-info";
import {
  getDesktopUpdateStatus,
  isClientCheckPending,
  onClientCheckSettle,
  refreshDesktopUpdate,
  requestClientCheck,
  requestClientDownload,
  requestClientInstall,
  useDesktopUpdate,
} from "./use-desktop-update";
import { useAuth } from "../state/auth";

/** How often the running self-update job is asked where it is. */
const JOB_POLL_MS = 1_000;
/** How often the page asks whether the restarted server is back. */
const RESTART_POLL_MS = 1_000;
/** A restart that has not come back by then is reported; the page stops waiting. */
const RESTART_TIMEOUT_MS = 90_000;

interface FlowState extends FlowLocal {
  /** Set by the owner from the session; actions read it to pick the backend. */
  mode: UpdateMode;
  isAdmin: boolean;
  modalOpen: boolean;
  /** The server's self-update job as last polled (release mode). */
  job: UpdateJobStatus | null;
}

const store = createStore<FlowState>(() => ({
  mode: "none",
  isAdmin: false,
  modalOpen: false,
  checking: false,
  downloadRequested: false,
  restart: "none",
  job: null,
}));

/** The flow for the current caches and local state — the one computation every surface renders. */
function currentFlow(): UpdateFlow {
  const s = store.getState();
  // Nothing this session can act on (a browser signed into a desktop-mode server, and the
  // beat before the owner has read the session): the flow stays `unknown`, so the row, the
  // badge and the modal all render nothing. It must not fall through to the release flow —
  // the avatar's dot reads this without a mode gate of its own, and a dot leading to a menu
  // with no update row is exactly the dead end update-badges.ts forbids.
  if (s.mode === "none") return { kind: "unknown" };
  // The armed client check is the shell store's own flag: it spins the flow until the
  // shell's `checking` frame lands, exactly as `checking` does for the release lookup.
  if (s.mode === "client") {
    return clientFlow(getDesktopUpdateStatus(), { ...s, checking: isClientCheckPending() });
  }
  const { version, update } = getVersionInfo();
  return releaseFlow({ version, update, job: s.job, isAdmin: s.isAdmin }, s);
}

/** Outcomes that land while the modal is closed are toasted; open, the modal shows them. */
function quiet(): boolean {
  return store.getState().modalOpen;
}

export function openUpdateModal(): void {
  store.setState({ modalOpen: true });
  if (opensWithCheck(currentFlow())) void checkForUpdates();
}

/** Closing never cancels anything: a download in flight keeps going and reports through the row. */
export function closeUpdateModal(): void {
  store.setState({ modalOpen: false });
}

export async function checkForUpdates(): Promise<void> {
  const s = store.getState();
  if (s.checking) return;
  if (s.mode === "client") {
    await requestClientCheck();
    return;
  }
  store.setState({ checking: true });
  try {
    const outcome = updateCheckOutcome(await forceUpdateCheck());
    if (quiet()) return;
    if (outcome.kind === "disabled") toastInfo(S.update.checkDisabled);
    else if (outcome.kind === "failed") toastError(S.update.checkFailed);
    else if (outcome.kind === "found") toastSuccess(S.update.foundNew(outcome.latestVersion));
    else toastSuccess(S.update.upToDate);
  } catch (e) {
    if (!quiet()) toastError(apiErrorText(e));
  } finally {
    store.setState({ checking: false });
  }
}

/** The user's confirmation: fetch (and, on a server, install) the offered release. */
export async function downloadUpdate(): Promise<void> {
  const s = store.getState();
  if (s.downloadRequested) return;
  store.setState({ downloadRequested: true, restart: "none" });
  try {
    if (s.mode === "client") {
      await requestClientDownload();
      // The snapshot takes over from here (see the owner effect); the local flag only bridges
      // the gap until the shell's `downloading` frame lands.
      return;
    }
    // The status the POST answers with is the whole truth from here on — including a run
    // that is already over (no CLI to run answers `done`/`unsupported` at once). Keeping
    // the local flag past it would render `downloading` forever: releaseFlow reads the
    // flag before the finished job, and only a RUNNING job is ever polled.
    const job = await api.startUpdateJob();
    store.setState({ job, downloadRequested: false });
  } catch (e) {
    toastError(S.update.requestFailed(apiErrorText(e)));
    store.setState({ downloadRequested: false });
  }
}

/** The user's "restart and update". */
export async function installUpdate(): Promise<void> {
  const s = store.getState();
  try {
    if (s.mode === "client") {
      await requestClientInstall();
      store.setState({ restart: "requested" });
      return;
    }
    const res = await api.restartServer();
    store.setState({ restart: res.restarting ? "requested" : "manual" });
  } catch (e) {
    toastError(S.update.requestFailed(apiErrorText(e)));
  }
}

/** Passive read of the flow, for the row, the badge and the modal's rendering. */
export function useUpdateFlow(): {
  mode: UpdateMode;
  flow: UpdateFlow;
  modalOpen: boolean;
  isAdmin: boolean;
  /** The running version, for the modal's header and the row's chip. */
  currentVersion: string | null;
} {
  const state = useStore(store);
  const { version } = useVersionInfo(false);
  useDesktopUpdate(false, false);
  return {
    mode: state.mode,
    flow: currentFlow(),
    modalOpen: state.modalOpen,
    isAdmin: state.isAdmin,
    currentVersion:
      state.mode === "client"
        ? (getDesktopUpdateStatus()?.appVersion ?? null)
        : (version?.version ?? null),
  };
}

/**
 * The one owner: sets the mode from the session, drives the shell polling while the modal is
 * open or something moves, polls the running job, waits out a restart, and toasts the
 * outcomes that land while the modal is closed. Mounted once, by the update modal.
 */
export function useUpdateFlowOwner(): void {
  const { user, desktopMode, sessionVia } = useAuth();
  const mode = updateModeFor({ desktopMode, sessionVia });
  const isAdmin = user?.isAdmin === true;
  useEffect(() => {
    store.setState({ mode, isAdmin });
  }, [mode, isAdmin]);

  const state = useStore(store);
  // A run still in flight from before this page load (or from another tab): "continue in
  // background" has to survive a reload, and only the server knows what is running. A
  // FINISHED run is deliberately not adopted — its outcome was already reported where it
  // was started, and resurrecting it here would answer every later page load with a stale
  // failure instead of the release still on offer. Admin-only (so is the endpoint), once
  // per mount; a failure leaves the flow on the check, which it would have shown anyway.
  useEffect(() => {
    if (mode !== "release" || !isAdmin) return;
    void api
      .getUpdateJob()
      .then((job) => {
        if (job.state === "running" && store.getState().job === null) store.setState({ job });
      })
      .catch(() => undefined);
  }, [mode, isAdmin]);

  // The shell's snapshot: polled while the modal is open, and on its own while a check or
  // download moves (use-desktop-update's own rule), so a download sent to the background
  // still reports through the row. One passive refresh on load raises a badge for a release
  // offered or downloaded before this page opened.
  const { status } = useDesktopUpdate(mode === "client", state.modalOpen);
  useEffect(() => {
    if (mode === "client") refreshDesktopUpdate();
  }, [mode]);

  // A settled client check reports in the modal when it is open, as a toast otherwise.
  useEffect(() => {
    onClientCheckSettle((settle) => {
      if (quiet()) return;
      switch (settle.kind) {
        case "up-to-date":
          toastSuccess(S.update.upToDate);
          break;
        case "found":
          toastSuccess(
            settle.version !== null ? S.update.foundNew(settle.version) : S.update.foundNewUnnamed,
          );
          break;
        case "ready":
          toastSuccess(S.update.readyToast(settle.version));
          break;
        case "unsupported":
          toastInfo(
            settle.reason === "linux-not-appimage"
              ? S.update.unsupportedNonAppImage
              : S.update.unsupportedDev,
          );
          break;
        default:
          toastError(
            settle.message !== null
              ? S.update.clientUpdateFailed(settle.message)
              : S.update.checkFailed,
          );
      }
    });
  }, []);

  // The download request's bridge: once the shell reports the download (or anything else —
  // a stale frame answers with a re-announce), the local flag has done its job.
  const requestSeq = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== "client") return;
    if (state.downloadRequested) {
      // -1 stands in for a snapshot without a seq (only the shell's very first frame): any
      // later frame carries one, so it still reads as movement.
      const seq = status?.seq ?? -1;
      if (requestSeq.current === null) requestSeq.current = seq;
      else if (seq !== requestSeq.current || status?.state === "downloading") {
        requestSeq.current = null;
        store.setState({ downloadRequested: false });
      }
    } else {
      requestSeq.current = null;
    }
  }, [mode, state.downloadRequested, status]);

  // A client download that lands while the modal is closed is announced; open, the modal
  // shows the restart step itself.
  const lastClientState = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "client") return;
    const now = status?.state ?? null;
    if (now === "downloaded" && lastClientState.current === "downloading" && !quiet()) {
      toastSuccess(S.update.readyToast(status?.version ?? null));
    }
    lastClientState.current = now;
  }, [mode, status]);

  // The running self-update job (release mode): polled until it ends, then announced when
  // the modal is closed.
  const running = mode === "release" && state.job?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void api
        .getUpdateJob()
        .then((job) => {
          // Only the tick that sees the run end announces it: a slow earlier tick landing
          // afterwards must not toast a second time.
          const wasRunning = store.getState().job?.state === "running";
          store.setState({ job, downloadRequested: false });
          if (!wasRunning || job.state !== "done" || job.result === undefined || quiet()) return;
          if (job.result.status === "updated") toastSuccess(S.update.readyToast(job.targetVersion));
          else if (job.result.status === "failed") toastError(S.update.failedToast);
          else toastInfo(S.update.unsupportedToast);
        })
        .catch(() => {
          // Transient: the next tick asks again (the job keeps running on the server).
        });
    }, JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  // The restart (release mode): the server goes down and comes back on the new release;
  // the page reloads once it answers again — after having seen it gone, or with another
  // version — and gives up after a while with a hint.
  const restarting = mode === "release" && state.restart === "requested";
  useEffect(() => {
    if (!restarting) return;
    const before = getVersionInfo().version?.version ?? null;
    const startedAt = Date.now();
    let sawDown = false;
    const giveUp = (): void => {
      store.setState({ restart: "manual" });
      toastError(S.update.restartTimedOut);
    };
    const timer = setInterval(() => {
      // The deadline is checked on every tick, not only on a failed one. A poll that keeps
      // SUCCEEDING is the case that hangs: the restart window fell between two ticks and
      // the relaunched server reports the same version (the update was already installed,
      // so `penguin update` only reinstalled it), or the restart never happened at all —
      // `sawDown` then stays false and nothing here would ever end the wait.
      if (Date.now() - startedAt > RESTART_TIMEOUT_MS) {
        giveUp();
        return;
      }
      void api
        .getVersion()
        .then((res) => {
          if (sawDown || (before !== null && res.version !== before)) window.location.reload();
        })
        .catch(() => {
          sawDown = true;
        });
    }, RESTART_POLL_MS);
    return () => clearInterval(timer);
  }, [restarting]);
}
