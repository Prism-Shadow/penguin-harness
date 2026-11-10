/**
 * An app opened from the App Center, windowed: it takes the App Center's area — the sidebar and
 * the rest of the app stay — in a window of the area's `WindowStack` over the grid, which stays
 * mounted underneath with its scroll. The title bar names the app and carries two flat buttons:
 * open it full screen (the full page, whose exit comes back to this window), and close, which
 * returns to the grid.
 *
 * The page itself is the same frame the chat's workbench tabs and the full page show, read the
 * same way (useAppPageTab): it follows the workbench as it reloads, and a workbench removed under
 * it closes the window.
 */
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { GlyphIcon, ICONS, ICON_SIZE, IconButton } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useAppPageTab, WorkbenchFrame } from "../workbenches";
import { TileIcon } from "./app-tile";

/** The title bar's icon: one rung above a line glyph in the same slot, as an avatar sits. */
const BAR_ICON_PX = ICON_SIZE.sectionMark;

export function AppCenterWindow({
  projectId,
  shortcut,
  title,
  onClose,
  onFullScreen,
}: {
  projectId: string;
  shortcut: AppCenterShortcut;
  title: string;
  onClose: () => void;
  onFullScreen: () => void;
}) {
  const { tab, off, failure } = useAppPageTab({
    projectId,
    agentId: shortcut.agentId,
    workbenchId: shortcut.workbenchId,
    tabKey: shortcut.tab,
    machineId: null,
    ownEvents: false,
  });
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <TileIcon shortcut={shortcut} title={title} size={BAR_ICON_PX} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{title}</h1>
        <IconButton
          variant="ghost"
          size="sm"
          label={S.appCenter.windowFullScreen}
          onClick={onFullScreen}
        >
          <GlyphIcon d={ICONS.cornersOut} size={ICON_SIZE.iconButton} />
        </IconButton>
        <IconButton variant="ghost" size="sm" label={S.appCenter.windowClose} onClick={onClose}>
          <GlyphIcon d={ICONS.cross} size={ICON_SIZE.iconButton} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {tab ? (
          <WorkbenchFrame
            projectId={projectId}
            agentId={shortcut.agentId}
            tab={tab}
            bare
            onChanged={() => undefined}
            onRemoved={onClose}
          />
        ) : (
          <p
            role="status"
            className="flex h-full items-center justify-center px-6 text-sm text-fg-muted"
          >
            {tab === undefined && failure === null
              ? S.workbenches.loadingPage
              : (failure ?? (off ? S.workbenches.offPage : S.workbenches.noSuchPage))}
          </p>
        )}
      </div>
    </section>
  );
}
