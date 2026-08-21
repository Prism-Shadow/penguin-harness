/**
 * Server-update row in the sidebar user menu — the web counterpart of DesktopUpdateRow,
 * sitting in the same slot under the System settings entry so the update affordance is
 * reachable without opening a dialog. Hidden in desktop mode, where updating is the
 * shell's job and the client row takes this slot instead.
 *
 * One row, two states: it reads "check for updates" and runs the manual check until a
 * newer release is known, then names that release and opens UpdateDialog (which carries
 * the release-notes link and the admin-only self-update). Deliberately thin — the check
 * state and the dialog live in the Sidebar, which stays mounted while this row unmounts
 * with the menu, so a check clicked here still settles and still toasts.
 */
import { S } from "../../lib/strings";

export function ServerUpdateRow({
  version,
  newVersion,
  checking,
  menuItemClass,
  onCheck,
  onOpenDialog,
}: {
  /** Running server version for the right-aligned chip; null until the lazy fetch lands. */
  version: string | null;
  /** The newer release this row names, or null while none is known. */
  newVersion: string | null;
  /** A manual check is in flight (owned by the Sidebar, so it survives the menu closing). */
  checking: boolean;
  /** The menu's shared row class (owned by sidebar.tsx). */
  menuItemClass: string;
  /** Check click: forces a lookup past the server's TTL cache and toasts the outcome. */
  onCheck: () => void;
  /** Update click: the Sidebar closes the menu and opens UpdateDialog. */
  onOpenDialog: () => void;
}) {
  const offersUpdate = newVersion !== null;
  const label = checking
    ? S.update.checking
    : offersUpdate
      ? S.update.newVersion(newVersion)
      : S.update.checkNow;

  return (
    <button
      type="button"
      disabled={checking}
      onClick={offersUpdate ? onOpenDialog : onCheck}
      className={`${menuItemClass} flex items-center justify-between gap-2 disabled:cursor-default disabled:opacity-60`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {checking && (
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
          />
        )}
        {!checking && offersUpdate && (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-bg)]" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {version !== null && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{`v${version}`}</span>
      )}
    </button>
  );
}
