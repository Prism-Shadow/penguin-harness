/**
 * An app opened from the App Center, windowed: it takes the App Center's area — the sidebar and
 * the rest of the app stay — in a window over the grid, which stays mounted underneath with its
 * scroll. The title bar (the UI package's `AppWindowBar`) names the app and carries three flat
 * buttons: minimize, which hides the window and keeps the app running; open it full screen (the
 * full page, whose exit comes back to this window); and close, which ends the app. Where the
 * window lives and what minimize keeps is app-center-windows.tsx's.
 *
 * What the window draws depends on how the app is drawn:
 * - an Agent's workbench: the same frame the chat's workbench tabs and the full page show, read
 *   the same way (useAppPageTab): it follows the workbench as it reloads, and a workbench removed
 *   under it closes the window;
 * - a system app a server module draws in an iframe: that page's document, with its location
 *   inside it kept in the window's address (frame-app-body.tsx).
 */
import { AppWindowBar, ICON_SIZE } from "@prismshadow/penguin-ui";
import type { LocatedShortcut } from "./arrangement";
import { S } from "../../lib/strings";
import { useAppPageTab, WorkbenchFrame } from "../workbenches";
import { TileIcon } from "./app-tile";
import { FrameAppBody } from "./frame-app-body";

/** The title bar's icon: one rung above a line glyph in the same slot, as an avatar sits. */
const BAR_ICON_PX = ICON_SIZE.sectionMark;

export function AppCenterWindow({
  appKey,
  projectId,
  shortcut,
  title,
  onMinimize,
  onClose,
  onFullScreen,
}: {
  /** The window's key in the address (`?app=`). */
  appKey: string;
  projectId: string;
  shortcut: LocatedShortcut;
  title: string;
  onMinimize: () => void;
  onClose: () => void;
  onFullScreen: () => void;
}) {
  const frame = shortcut.system?.frame;
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <AppWindowBar
        icon={<TileIcon shortcut={shortcut} title={title} size={BAR_ICON_PX} />}
        title={title}
        labels={{
          minimize: S.appCenter.windowMinimize,
          fullScreen: S.appCenter.windowFullScreen,
          close: S.appCenter.windowClose,
        }}
        onMinimize={onMinimize}
        onFullScreen={onFullScreen}
        onClose={onClose}
      />
      <div className="relative min-h-0 flex-1">
        {frame !== undefined ? (
          <FrameAppBody appKey={appKey} projectId={projectId} src={frame} title={title} />
        ) : (
          <WorkbenchBody projectId={projectId} shortcut={shortcut} onClose={onClose} />
        )}
      </div>
    </section>
  );
}

/** An Agent's workbench page, read as the full page reads it. */
function WorkbenchBody({
  projectId,
  shortcut,
  onClose,
}: {
  projectId: string;
  shortcut: LocatedShortcut;
  onClose: () => void;
}) {
  const { tab, off, failure } = useAppPageTab({
    projectId,
    agentId: shortcut.agentId,
    workbenchId: shortcut.workbenchId,
    tabKey: shortcut.tab,
    machineId: shortcut.machineId ?? null,
    ownEvents: false,
  });
  return tab ? (
    <WorkbenchFrame
      projectId={projectId}
      agentId={shortcut.agentId}
      tab={tab}
      bare
      onChanged={() => undefined}
      onRemoved={onClose}
    />
  ) : (
    <p role="status" className="flex h-full items-center justify-center px-6 text-sm text-fg-muted">
      {tab === undefined && failure === null
        ? S.workbenches.loadingPage
        : (failure ?? (off ? S.workbenches.offPage : S.workbenches.noSuchPage))}
    </p>
  );
}
