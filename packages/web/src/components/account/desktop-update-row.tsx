/**
 * Client-update row in the sidebar user menu — the desktop-mode counterpart of the
 * server update reminder (which stays hidden there: the CLI self-update has nothing to
 * run under the shell). Rendered only in the shell's own window (see offersClientUpdate).
 *
 * Deliberately thin: the snapshot, the polling and the armed-check watch live in
 * use-desktop-update.ts at module level, because this row unmounts whenever the menu
 * closes — a check clicked here must still settle (and toast) afterwards. Install is
 * not sent from here either: the click hands off to the Sidebar's confirm dialog
 * (restarting interrupts running tasks, the same consent the shell's native prompt
 * collects), which posts on confirmation.
 */
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { clientUpdateRow } from "../../lib/desktop-update";
import { requestClientCheck } from "../../lib/use-desktop-update";

export function DesktopUpdateRow({
  status,
  checkPending,
  menuItemClass,
  onInstallRequest,
}: {
  /** Latest shell snapshot (null until its first push). */
  status: DesktopUpdateStatus | null;
  /** A row-initiated check is armed but the shell's `checking` frame hasn't landed yet. */
  checkPending: boolean;
  /** The menu's shared row class (owned by sidebar.tsx). */
  menuItemClass: string;
  /** Install click: the Sidebar closes the menu and opens the confirm dialog. */
  onInstallRequest: () => void;
}) {
  const row = clientUpdateRow(status, checkPending);
  const disabled = row.action === "none";

  const label =
    row.labelKind === "checking"
      ? S.update.checking
      : row.labelKind === "downloading"
        ? S.update.clientDownloading(row.version, row.percent)
        : row.labelKind === "install"
          ? S.update.clientRestartToInstall(row.version)
          : S.update.clientCheckNow;

  const reason =
    row.labelKind === "unsupported"
      ? row.unsupportedReason === "linux-not-appimage"
        ? S.update.clientUnsupportedPackage
        : S.update.clientUnsupportedDev
      : null;

  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (row.action === "install") onInstallRequest();
        else if (row.action === "check") void requestClientCheck();
      }}
      className={`${menuItemClass} flex items-center justify-between gap-2 disabled:cursor-default disabled:opacity-60`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {row.busy && (
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
          />
        )}
        {!row.busy && row.labelKind === "install" && (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-bg)]" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {row.appVersion !== null && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {`v${row.appVersion}`}
        </span>
      )}
    </button>
  );

  // The unsupported reason has to hang off a wrapper: Chromium dispatches no pointer
  // events to a disabled control, so a `title` written on the button itself never opens
  // a tooltip — and the reason is the only thing that explains why the row is greyed out.
  return reason !== null ? (
    <span className="block" title={reason}>
      {button}
    </span>
  ) : (
    button
  );
}
