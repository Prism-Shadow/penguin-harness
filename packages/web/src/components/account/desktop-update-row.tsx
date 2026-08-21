/**
 * Client-update row in the sidebar user menu — the desktop-mode counterpart of the
 * server-update row (which stays hidden there: the CLI self-update has nothing to run
 * under the shell). Rendered only in the shell's own window (see offersClientUpdate).
 *
 * Data is the shell's updater snapshot, polled while the menu is open — a click needs
 * fresh state, and download progress should move without a reopen. A row-initiated
 * check toasts exactly one outcome (found / up to date / failed), the same contract as
 * the server-update row's manual check; found and downloading need no persistent row
 * state of their own beyond what the snapshot already says. Install goes through
 * POST /api/desktop/update/install → the shell's quitAndInstall: the app restarts, so
 * there is nothing to render after a successful request.
 */
import { useEffect, useRef, useState } from "react";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { clientCheckSettle, clientUpdateRow } from "../../lib/desktop-update";
import { toastError, toastSuccess } from "../ui/toast";

/** Poll cadence while the menu is open: fast enough for progress to feel live, local-only traffic. */
const POLL_MS = 1500;

export function DesktopUpdateRow({
  active,
  menuItemClass,
}: {
  /** The user menu is open: poll while true. */
  active: boolean;
  /** The menu's shared row class (owned by sidebar.tsx). */
  menuItemClass: string;
}) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  /** A row-initiated check awaiting its one settle toast; null = none in flight. */
  const watch = useRef<{ atClick: DesktopUpdateStatus | null; sawChecking: boolean } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.getDesktopUpdate();
        if (cancelled) return;
        setStatus(res.status);
        const w = watch.current;
        if (w !== null && res.status?.state === "checking") w.sawChecking = true;
        if (w !== null) {
          const settle = clientCheckSettle(w.atClick, res.status, w.sawChecking);
          if (settle !== null) {
            watch.current = null;
            if (settle.kind === "up-to-date") toastSuccess(S.update.upToDate);
            else if (settle.kind === "found") toastSuccess(S.update.clientFoundNew(settle.version));
            else toastError(S.update.checkFailed);
          }
        }
      } catch {
        // The menu may outlive a server restart by a beat; the next poll self-corrects.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  const row = clientUpdateRow(status);

  const click = async () => {
    if (row.action === "none") return;
    try {
      if (row.action === "install") {
        await api.desktopUpdateInstall();
        // The shell restarts the app from here; nothing to render.
      } else {
        watch.current = { atClick: status, sawChecking: false };
        await api.desktopUpdateCheck();
      }
    } catch {
      watch.current = null;
      toastError(S.update.checkFailed);
    }
  };

  const label =
    row.labelKind === "checking"
      ? S.update.checking
      : row.labelKind === "downloading"
        ? S.update.clientDownloading(row.version, row.percent)
        : row.labelKind === "install"
          ? S.update.clientRestartToInstall(row.version)
          : S.update.clientCheckNow;

  return (
    <button
      type="button"
      disabled={row.action === "none"}
      onClick={() => void click()}
      {...(row.labelKind === "unsupported"
        ? {
            title:
              row.unsupportedReason === "linux-not-appimage"
                ? S.update.clientUnsupportedPackage
                : S.update.clientUnsupportedDev,
          }
        : {})}
      className={`${menuItemClass} flex items-center justify-between gap-2 disabled:cursor-default disabled:opacity-60`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {row.busy && (
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
          />
        )}
        {row.labelKind === "install" && (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-bg)]" />
        )}
        <span className="min-w-0 truncate">
          {row.labelKind === "unsupported" ? S.update.clientCheckNow : label}
        </span>
      </span>
      {row.appVersion !== null && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {`v${row.appVersion}`}
        </span>
      )}
    </button>
  );
}
