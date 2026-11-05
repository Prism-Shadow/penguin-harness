/**
 * The account-menu App info row — one row for every session, opening the App info dialog. Its
 * label never changes and the running version sits muted on the right. While the update flow
 * moves or waits (checking / a release offered / downloading with its percentage / restart to
 * update / restarting), a status line under the label says so, in the same words the avatar's
 * badge uses, so the badge leads to its own sentence; idle, and for an install that cannot
 * update itself, the row says nothing more. A session that can update nothing (see
 * updateModeFor) still gets the row: the version, the release notes and the licences are for
 * everyone. A Menu row, like the menu's other entries.
 */
import { MenuItem, Spinner } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { updateRowModel } from "../../lib/update-flow";
import type { UpdateFlow } from "../../lib/update-flow";
import { useUpdateFlow } from "../../lib/use-update-flow";

export function AppInfoRow({
  onOpen,
}: {
  /** Click: the account menu closes and the App info dialog opens. */
  onOpen: () => void;
}) {
  const { flow, currentVersion } = useUpdateFlow();
  const row = updateRowModel(flow);
  return (
    <MenuItem
      glyph={
        row.busy ? (
          // The status line already says what is running; hidden, the spinner stays out of the
          // menu item's accessible name.
          <span aria-hidden className="flex shrink-0">
            <Spinner size="sm" label={S.common.loading} />
          </span>
        ) : row.dot ? (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        ) : undefined
      }
      label={S.appInfo.menuEntry}
      description={row.announces ? rowLabel(flow) : undefined}
      trailing={currentVersion !== null ? `v${currentVersion}` : undefined}
      onSelect={onOpen}
    />
  );
}

/** The row's status line for one flow — read at render time (`S` is a live binding). */
export function rowLabel(flow: UpdateFlow): string {
  switch (flow.kind) {
    case "checking":
      return S.update.checking;
    case "available":
      return S.update.newVersion(flow.version);
    case "downloading":
      return S.update.rowDownloading(flow.version, flow.percent);
    case "ready":
      return S.update.restartToUpdate(flow.version);
    case "restarting":
      return S.update.rowRestarting;
    default:
      return S.update.checkNow;
  }
}
