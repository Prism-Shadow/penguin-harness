/**
 * The desktop shell's updater snapshot, shared by everything that reads it: the polling that
 * feeds it, the armed row-initiated check, and the three relay requests (check / download /
 * install). Client-mode half of the update flow — `use-update-flow.ts` reads the snapshot
 * through `useDesktopUpdate` and turns it into the modal's state.
 *
 * Everything lives at module level (use-version-info.ts convention): a check armed from the
 * modal must still settle after the modal is closed, and a download sent to the background
 * must keep reporting through the account-menu row. One always-mounted owner (the update
 * modal) drives the polling — fast while something is moving (checking, downloading, an
 * armed watch), lazily otherwise, and not at all when nothing is open and nothing moves: a
 * terminal snapshot (up to date, downloaded) cannot change between clicks.
 */
import { useEffect, useReducer } from "react";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { clientCheckSettle } from "./desktop-update";
import type { ClientCheckSettle } from "./desktop-update";

/** Poll cadence while a check or download is moving (or a watch is armed). */
const FAST_POLL_MS = 1_500;
/** Poll cadence for a static snapshot while the modal or menu is open — just enough to notice outside activity (the timer check, the native menu). */
const SLOW_POLL_MS = 8_000;

let statusCache: DesktopUpdateStatus | null = null;
let inflight: Promise<void> | null = null;
/** The armed row-initiated check; null = none. Module-level so it survives the modal closing. */
let watch: { atClickSeq: number | null; armedAt: number } | null = null;
const listeners = new Set<() => void>();
/** Where a settled check reports (use-update-flow.ts decides between the modal and a toast). */
let settleListener: ((settle: ClientCheckSettle) => void) | null = null;

function notifyAll(): void {
  for (const notify of listeners) notify();
}

/** The latest snapshot, for callers outside React (the flow's actions). */
export function getDesktopUpdateStatus(): DesktopUpdateStatus | null {
  return statusCache;
}

/** Whether a row-initiated check is armed and unsettled (the shell's `checking` frame may not have landed yet). */
export function isClientCheckPending(): boolean {
  return watch !== null;
}

/** Registers the one place a settled check reports to. */
export function onClientCheckSettle(listener: (settle: ClientCheckSettle) => void): void {
  settleListener = listener;
}

/** Settles the armed check against the current cache, reporting its one outcome. */
function settleWatch(): void {
  if (watch === null) return;
  const settle = clientCheckSettle(watch.atClickSeq, statusCache, Date.now() - watch.armedAt);
  if (settle === null) return;
  watch = null;
  settleListener?.(settle);
}

/** One shared GET: concurrent callers ride the in-flight request (terminal-list.ts convention), so a slow answer can never be overtaken and overwritten by a newer one. */
function poll(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.getDesktopUpdate();
      statusCache = res.status;
    } catch {
      // The page can outlive a server restart by a beat; the next poll self-corrects.
      // An armed watch still ages toward its timeout through the settle below.
    } finally {
      inflight = null;
      settleWatch();
      notifyAll();
    }
  })();
  return inflight;
}

/**
 * One passive read of the shell's updater snapshot, for a consumer that does not poll: the
 * update badge asks once per app load so a release offered or downloaded before this load
 * can raise its dot without the user opening anything. Concurrent callers ride the in-flight GET.
 */
export function refreshDesktopUpdate(): void {
  void poll();
}

/** Arms the settle watch, then asks the shell to check. A failed POST disarms and reports itself through the settle listener. */
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
    settleListener?.({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
  }
}

/** Asks the shell to fetch the release it offered; the snapshot reports the download from there. Rejects when the POST fails. */
export async function requestClientDownload(): Promise<void> {
  await api.desktopUpdateDownload();
  void poll();
}

/** Asks the shell to restart into the downloaded build; success renders nothing (the window goes away). Rejects when the POST fails. */
export async function requestClientInstall(): Promise<void> {
  await api.desktopUpdateInstall();
}

/**
 * The snapshot, plus whether a row-initiated check is still unsettled (the flow spins on
 * it before the shell's `checking` frame lands). `enabled` is client mode; `wanted` is a
 * surface being open (the modal, the menu) — polling also runs on its own while a check or
 * download is moving, so a download sent to the background still reports.
 */
export function useDesktopUpdate(
  enabled: boolean,
  wanted: boolean,
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
  const active = enabled && (wanted || hot);
  useEffect(() => {
    if (!active) return;
    void poll();
    const timer = setInterval(() => void poll(), hot ? FAST_POLL_MS : SLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [active, hot]);

  return { status: statusCache, checkPending };
}
