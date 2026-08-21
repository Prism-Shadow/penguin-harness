/**
 * Files panel: on desktop (≥1024px, see isDocked in use-files-panel.ts) it docks to the right
 * of the chat with a drag-to-resize edge; on narrower viewports it becomes a bottom Sheet
 * (snaps to half for browsing / full for preview, gesture-draggable) so the vertical layout
 * keeps the chat transcript above it visible. Content is one of two sibling views, switched
 * by the flat toggle in the title row: the WorkspaceBrowser directory tree (clicking a file
 * chip in a message navigates it via openRequest), or the Agent's Memory view (this
 * conversation's memory diffs + the memory itself; a memory-changes card row navigates it
 * via memoryRequest) — see use-files-panel.ts for both commands.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Sheet } from "../../components/ui/sheet";
import { CloseIcon } from "../../components/ui/icons";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { WorkspaceBrowser } from "./workspace-browser";
import { ChatMemoryView } from "./memory-view";
import type { FilesPanelState } from "./use-files-panel";

/** View-toggle glyphs: the file-summary card's page for the tree, an open book for Memory. */
const FILES_VIEW_ICON = "M6 3h8l4 4v14H6zM14 3v4h4";
const MEMORY_VIEW_ICON =
  "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z";

interface FilesPanelProps {
  session: SessionInfo;
  panel: FilesPanelState;
  /** This conversation's aggregated memory changes, for the Memory view's diff section. */
  memoryChanges: MemoryChangeRow[];
  /** Opens the agent-settings memory tab (the Memory view's management link). */
  onOpenMemorySettings?: (() => void) | undefined;
}

/** The two-view toggle: flat icon buttons, the active view's glyph emphasized. */
function ViewToggle({ panel }: { panel: FilesPanelState }) {
  const button = (view: "files" | "memory", d: string, title: string) => (
    <button
      type="button"
      onClick={() => panel.setView(view)}
      title={title}
      aria-pressed={panel.view === view}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 ${
        panel.view === view
          ? "text-gray-700 dark:text-gray-200"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      }`}
    >
      <GlyphIcon d={d} size={ICON_SIZE.iconButton} />
      <span className="sr-only">{title}</span>
    </button>
  );
  return (
    <div className="flex shrink-0 items-center">
      {button("files", FILES_VIEW_ICON, S.files.title)}
      {button("memory", MEMORY_VIEW_ICON, S.chat.memoryViewTitle)}
    </div>
  );
}

export function FilesPanel({
  session,
  panel,
  memoryChanges,
  onOpenMemorySettings,
}: FilesPanelProps) {
  // The tree stays mounted and merely hidden while Memory is up — collapsing it would drop
  // the user's expanded-directory state on every toggle; the Memory view is cheap to remount.
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
      {panel.view === "memory" && (
        <ChatMemoryView
          session={session}
          changes={memoryChanges}
          request={panel.memoryRequest}
          {...(onOpenMemorySettings ? { onOpenSettings: onOpenMemorySettings } : {})}
        />
      )}
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
          <div className="flex shrink-0 items-center justify-end px-2 pt-1">
            <ViewToggle panel={panel} />
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
          {/* Title row for docked state (the Sheet state has its own title bar via Sheet, no duplication needed) */}
          <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {panel.view === "memory" ? S.chat.memoryViewTitle : S.files.title}
            </h4>
            <ViewToggle panel={panel} />
            <button
              type="button"
              onClick={() => panel.setOpen(false)}
              title={S.common.close}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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
