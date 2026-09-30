/**
 * The account-menu update row — one row for both backends, reading the update flow. It
 * names where the flow stands (check / checking / a release offered / downloading with its
 * percentage / restart to update / restarting / cannot update), and every state opens the
 * update modal, which is where the flow is explained and acted on. The running version
 * sits muted on the right. Renders nothing where this session can update nothing. A Menu row,
 * like the menu's other entries.
 */
import { MenuItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { updateRowModel } from "../../lib/update-flow";
import type { UpdateFlow } from "../../lib/update-flow";
import { useUpdateFlow } from "../../lib/use-update-flow";

export function UpdateRow({
  onOpen,
}: {
  /** Click: the account menu closes and the update modal opens. */
  onOpen: () => void;
}) {
  const { mode, flow, currentVersion } = useUpdateFlow();
  if (mode === "none") return null;
  const row = updateRowModel(flow);
  return (
    <MenuItem
      glyph={
        row.busy ? (
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
          />
        ) : row.dot ? (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        ) : undefined
      }
      label={rowLabel(flow)}
      trailing={currentVersion !== null ? `v${currentVersion}` : undefined}
      onSelect={onOpen}
    />
  );
}

/** The row's wording for one flow — read at render time (`S` is a live binding). */
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
    case "unsupported":
      return S.update.rowUnsupported;
    default:
      return S.update.checkNow;
  }
}
