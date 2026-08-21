/**
 * Memory panel — a peer of the subagents and files panels, same shell behavior: docked to
 * the right with a drag-to-resize edge on desktop (≥1024px, see isDocked in
 * use-memory-panel.ts), a bottom Sheet on narrower viewports. Content is the two-level
 * Memory view (memory-view.tsx); the panel itself only provides the frame, mirroring
 * files-panel.tsx — including the inert width-collapse (see that file's notes on why the
 * node stays mounted and why the divider belongs to the open state only).
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Sheet } from "../../components/ui/sheet";
import { CloseIcon } from "../../components/ui/icons";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { ChatMemoryView } from "./memory-view";
import type { ScopeFiles } from "./memory-nav";
import type { MemoryPanelState } from "./use-memory-panel";

interface MemoryPanelProps {
  session: SessionInfo;
  panel: MemoryPanelState;
  /** This conversation's aggregated memory changes (identity-stable across streaming ticks — see chat-page's stabilization). */
  memoryChanges: MemoryChangeRow[];
  /** The server listing (loaded by chat-page's use-memory-listing) and its error, shared with the card's deleted-row marking. */
  scopes: ScopeFiles[] | null;
  listingError: string | null;
  /** Opens the agent-settings memory tab (the view's management link). */
  onOpenMemorySettings?: (() => void) | undefined;
}

export function MemoryPanel({
  session,
  panel,
  memoryChanges,
  scopes,
  listingError,
  onOpenMemorySettings,
}: MemoryPanelProps) {
  const view = (
    // Keyed by session: a new conversation starts back at the list level.
    <ChatMemoryView
      key={session.sessionId}
      session={session}
      changes={memoryChanges}
      scopes={scopes}
      listingError={listingError}
      request={panel.memoryRequest}
      active={panel.open}
      {...(onOpenMemorySettings ? { onOpenSettings: onOpenMemorySettings } : {})}
    />
  );

  if (!panel.isDocked) {
    return (
      <Sheet
        open={panel.open}
        snap={panel.sheetSnap}
        onSnapChange={panel.setSheetSnap}
        onClose={() => panel.setOpen(false)}
        title={S.chat.memoryViewTitle}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">{view}</div>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      {panel.open && (
        <div
          data-testid="memory-panel-resizer"
          onMouseDown={panel.startResize}
          onDoubleClick={panel.resetWidth}
          title={S.files.resizeHandle}
          className={`w-1.5 shrink-0 cursor-col-resize transition-colors duration-150 hover:bg-brand-300/50 dark:hover:bg-brand-700/40 ${
            panel.resizing ? "bg-brand-400/60" : "bg-transparent"
          }`}
        />
      )}
      <div
        data-testid="memory-panel"
        ref={panel.panelRef}
        style={{ width: panel.open ? panel.width : 0 }}
        inert={!panel.open}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden ${
          panel.open ? "border-l border-gray-200 dark:border-gray-800" : ""
        } ${panel.resizing ? "pointer-events-none" : "transition-[width] duration-200"}`}
      >
        <div style={{ width: panel.width }} className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {S.chat.memoryViewTitle}
            </h4>
            <button
              type="button"
              onClick={() => panel.setOpen(false)}
              title={S.common.close}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1">{view}</div>
        </div>
      </div>
    </>
  );
}
