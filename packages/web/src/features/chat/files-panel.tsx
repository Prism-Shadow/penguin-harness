/**
 * The chat's side panel: on desktop (≥1024px, see isDocked in use-files-panel.ts) it docks to
 * the right of the chat with a drag-to-resize edge; on narrower viewports it becomes a bottom
 * Sheet (snaps to half for browsing / full for preview, gesture-draggable) so the vertical
 * layout keeps the chat transcript above it visible. Content is two proper tabs (the shared
 * underline Tabs): the WorkspaceBrowser directory tree (a file chip in a message navigates it
 * via openRequest) and the Agent's Memory view (a memory-changes card row navigates it via
 * memoryRequest — see use-files-panel.ts for both commands). Entering the Memory tab through
 * its tab button always lands on the list level (openMemory(null)); only a card row's locate
 * target lands on a detail.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Sheet } from "../../components/ui/sheet";
import { CloseIcon } from "../../components/ui/icons";
import { Tabs } from "../../components/ui/tabs";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { WorkspaceBrowser } from "./workspace-browser";
import { ChatMemoryView } from "./memory-view";
import type { FilesPanelState } from "./use-files-panel";

interface FilesPanelProps {
  session: SessionInfo;
  panel: FilesPanelState;
  /** This conversation's aggregated memory changes, for the Memory tab's markers and diffs. */
  memoryChanges: MemoryChangeRow[];
  /** Opens the agent-settings memory tab (the Memory view's management link). */
  onOpenMemorySettings?: (() => void) | undefined;
}

/** The panel's tab bar. The memory tab routes through openMemory(null) so entering it always resets to the list level. */
function PanelTabs({ panel }: { panel: FilesPanelState }) {
  // Inside the component, not module-level: `S` is a live binding the locale switch swaps.
  const items = [
    { key: "files" as const, label: S.files.title },
    { key: "memory" as const, label: S.chat.memoryViewTitle },
  ];
  return (
    <Tabs
      items={items}
      active={panel.view}
      onChange={(key) => {
        if (key === "memory") panel.openMemory(null);
        else panel.setView("files");
      }}
    />
  );
}

export function FilesPanel({
  session,
  panel,
  memoryChanges,
  onOpenMemorySettings,
}: FilesPanelProps) {
  // Both tabs stay mounted, the inactive one hidden — collapsing the tree would drop the
  // user's expanded-directory state on every switch, and the memory view keeps its listing
  // and navigation level the same way (its entry routing is command-driven, see openMemory).
  const body = (previewToFull: boolean) => (
    <>
      <div className={panel.view === "files" ? "h-full min-h-0" : "hidden"}>
        <WorkspaceBrowser
          session={session}
          openRequest={panel.openRequest}
          active={panel.open && panel.view === "files"}
          {...(previewToFull ? { onPreviewOpen: () => panel.setSheetSnap("full") } : {})}
        />
      </div>
      <div className={panel.view === "memory" ? "h-full min-h-0" : "hidden"}>
        {/* Keyed by session: a new conversation starts back at the list level with a fresh listing. */}
        <ChatMemoryView
          key={session.sessionId}
          session={session}
          changes={memoryChanges}
          request={panel.memoryRequest}
          active={panel.open && panel.view === "memory"}
          {...(onOpenMemorySettings ? { onOpenSettings: onOpenMemorySettings } : {})}
        />
      </div>
    </>
  );

  if (!panel.isDocked) {
    return (
      <Sheet
        open={panel.open}
        snap={panel.sheetSnap}
        onSnapChange={panel.setSheetSnap}
        onClose={() => panel.setOpen(false)}
        title={panel.view === "memory" ? S.chat.memoryViewTitle : S.files.title}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 px-3">
            <PanelTabs panel={panel} />
          </div>
          {/* Preview from the tree's list view bumps the snap to full (preview needs the space) */}
          <div className="min-h-0 flex-1">{body(true)}</div>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      {panel.open && (
        <div
          data-testid="files-panel-resizer"
          onMouseDown={panel.startResize}
          onDoubleClick={panel.resetWidth}
          title={S.files.resizeHandle}
          className={`w-1.5 shrink-0 cursor-col-resize transition-colors duration-150 hover:bg-brand-300/50 dark:hover:bg-brand-700/40 ${
            panel.resizing ? "bg-brand-400/60" : "bg-transparent"
          }`}
        />
      )}
      <div
        data-testid="files-panel"
        ref={panel.panelRef}
        style={{ width: panel.open ? panel.width : 0 }}
        // Use inert rather than unmounting when closed: the width transition needs the node to
        // stay mounted, and inert removes content collapsed to 0 width from the tab order and
        // accessibility tree, so keyboard users can't Tab into a close button that's visually gone.
        inert={!panel.open}
        // Freeze the panel's pointer events while dragging to resize: a preview iframe
        // (HTML/PDF) is a separate document, and mousemove over it gets swallowed instead of
        // reaching us, so the width stops tracking the cursor; pointer-events-none lets events
        // pass through.
        //
        // relative: the clipping window acts as its own containing block. Content is fixed at
        // the target width (see below), and when closed the whole block sits outside the
        // viewport's right edge — if an absolute descendant (e.g. the upload button's sr-only
        // input) anchored to the nearest initial containing block instead, it would bypass this
        // overflow-hidden and stretch the **document** wide, making a horizontal scrollbar
        // appear out of nowhere.
        //
        // The divider belongs to the OPEN state only: with border-box sizing a closed panel's
        // border still paints its 1px even at width 0, and since both docked panels stay
        // mounted, the closed one left a stray line beside the open one — a hairline, a gap
        // (the open panel's resize handle) and then the real divider, which reads as an extra
        // empty panel wedged in. Both closed, the two leftover lines stacked at the window edge.
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden ${
          panel.open ? "border-l border-gray-200 dark:border-gray-800" : ""
        } ${panel.resizing ? "pointer-events-none" : "transition-[width] duration-200"}`}
      >
        {/* Content is fixed at the target width; the outer element is only a clipping window:
            during the open/close animation the outer element passes through intermediate
            widths, and if the content resized along with it, the text would get squeezed into
            a column frame-by-frame before expanding back out. With a fixed width, the content
            behaves as a rigid body that slides in and out past the clipping edge with zero
            reflow. While dragging to resize, both values stay in sync, so this isn't affected. */}
        <div style={{ width: panel.width }} className="flex h-full min-h-0 flex-col">
          {/* Tab row for docked state: the tab bar is the panel's title (the Sheet state keeps
              its own title bar via Sheet and carries the tab bar as its first content row). */}
          <div className="flex shrink-0 items-end gap-1 px-3 pt-1">
            <div className="min-w-0 flex-1">
              <PanelTabs panel={panel} />
            </div>
            <button
              type="button"
              onClick={() => panel.setOpen(false)}
              title={S.common.close}
              className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1">{body(false)}</div>
        </div>
      </div>
    </>
  );
}
