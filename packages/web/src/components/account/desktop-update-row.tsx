/**
 * Client-update row in the sidebar user menu — the desktop-mode counterpart of the
 * server-update row (which stays hidden there: the CLI self-update has nothing to run
 * under the shell). Rendered only in the shell's own window (see offersClientUpdate).
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
import { UpdateMenuRow } from "./update-menu-row";

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

  const label =
    row.labelKind === "checking"
      ? S.update.checking
      : row.labelKind === "downloading"
        ? S.update.clientDownloading(row.version, row.percent)
        : row.labelKind === "install"
          ? S.update.clientRestartToInstall(row.version)
          : S.update.clientCheckNow;

  return (
    <UpdateMenuRow
      menuItemClass={menuItemClass}
      label={label}
      chip={row.appVersion !== null ? `v${row.appVersion}` : null}
      busy={row.busy}
      dot={row.labelKind === "install"}
      disabled={row.action === "none"}
      {...(row.labelKind === "unsupported"
        ? {
            title:
              row.unsupportedReason === "linux-not-appimage"
                ? S.update.clientUnsupportedPackage
                : S.update.clientUnsupportedDev,
          }
        : {})}
      onClick={() => {
        if (row.action === "install") onInstallRequest();
        else if (row.action === "check") void requestClientCheck();
      }}
    />
  );
}
