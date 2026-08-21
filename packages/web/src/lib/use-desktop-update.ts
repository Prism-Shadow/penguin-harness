/**
 * Shared state behind the client-update row: the shell's updater snapshot, the armed
 * row-initiated check, and the polling that feeds both.
 *
 * Everything lives at module level (use-version-info.ts convention) because the row
 * itself unmounts with the user menu: a check armed there must still settle — and
 * toast its one outcome — after the menu closes. The single always-mounted consumer
 * is the Sidebar's hook instance, which keeps polling while the menu is open or a
 * watch is armed, fast only while something is actually moving (checking,
 * downloading, armed watch) and lazily otherwise — a terminal snapshot (unsupported,
 * downloaded) cannot change between clicks, so it only warrants an occasional
 * refresh.
 */
import { useEffect, useReducer } from "react";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { S } from "./strings";
import { apiErrorText } from "./api-error";
import { clientCheckSettle } from "./desktop-update";
import { toastError, toastInfo, toastSuccess } from "../components/ui/toast";

/** Poll cadence while a check or download is moving (or a watch is armed). */
const FAST_POLL_MS = 1_500;
/** Poll cadence for a static snapshot with the menu open — just enough to notice outside activity (the timer check, the native menu). */
const SLOW_POLL_MS = 8_000;

let statusCache: DesktopUpdateStatus | null = null;
let inflight: Promise<void> | null = null;
/** The armed row-initiated check; null = none. Module-level so it survives the menu closing. */
let watch: { atClickSeq: number | null; armedAt: number } | null = null;
const listeners = new Set<() => void>();

function notifyAll(): void {
  for (const notify of listeners) notify();
}

/** Settles the armed check against the current cache, toasting its one outcome. */
function settleWatch(): void {
  if (watch === null) return;
  const settle = clientCheckSettle(watch.atClickSeq, statusCache, Date.now() - watch.armedAt);
  if (settle === null) return;
  watch = null;
  switch (settle.kind) {
    case "up-to-date":
      toastSuccess(S.update.upToDate);
      break;
    case "found":
      toastSuccess(S.update.clientFoundNew(settle.version));
      break;
    case "ready":
      toastSuccess(S.update.clientDownloadReady(settle.version));
      break;
    case "unsupported":
      toastInfo(
        settle.reason === "linux-not-appimage"
          ? S.update.clientUnsupportedPackage
          : S.update.clientUnsupportedDev,
      );
      break;
    default:
      toastError(
        settle.message !== null
          ? S.update.clientUpdateFailed(settle.message)
          : S.update.checkFailed,
      );
  }
}

/** One shared GET: concurrent callers ride the in-flight request (terminal-list.ts convention), so a slow answer can never be overtaken and overwritten by a newer one. */
function poll(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.getDesktopUpdate();
      statusCache = res.status;
    } catch {
      // The menu can outlive a server restart by a beat; the next poll self-corrects.
      // An armed watch still ages toward its timeout through the settle below.
    } finally {
      inflight = null;
      settleWatch();
      notifyAll();
    }
  })();
  return inflight;
}

/** Row action: arm the settle watch, then ask the shell to check. A failed POST disarms and reports itself. */
export async function requestClientCheck(): Promise<void> {
  if (watch !== null) return;
  watch = { atClickSeq: statusCache?.seq ?? null, armedAt: Date.now() };
  notifyAll();
  try {
    await api.desktopUpdateCheck();
    void poll();
  } catch (e) {
    watch = null;
    notifyAll();
    toastError(apiErrorText(e));
  }
}

/** Row action, behind the page's confirm dialog: the shell restarts into the downloaded build, so success renders nothing. */
export async function requestClientInstall(): Promise<void> {
  try {
    await api.desktopUpdateInstall();
  } catch (e) {
    toastError(S.update.clientInstallFailed(apiErrorText(e)));
  }
}

/**
 * The Sidebar's single always-mounted subscription: current snapshot plus whether a
 * row-initiated check is still unsettled (the row spins on it before the shell's
 * `checking` frame lands).
 */
export function useDesktopUpdate(
  enabled: boolean,
  menuOpen: boolean,
): { status: DesktopUpdateStatus | null; checkPending: boolean } {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);

  const checkPending = watch !== null;
  const hot =
    checkPending || statusCache?.state === "checking" || statusCache?.state === "downloading";
  const active = enabled && (menuOpen || checkPending);
  useEffect(() => {
    if (!active) return;
    void poll();
    const timer = setInterval(() => void poll(), hot ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [active, hot]);

  return { status: statusCache, checkPending };
}
