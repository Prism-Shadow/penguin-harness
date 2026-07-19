/**
 * Files panel: on desktop (≥1024px, see isDocked in use-files-panel.ts) it docks to the right
 * of the chat with a drag-to-resize edge; on narrower viewports it becomes a bottom Sheet
 * (snaps to half for browsing / full for preview, gesture-draggable) so the vertical layout
 * keeps the chat transcript above it visible. Content is a single WorkspaceBrowser directory-tree
 * view; clicking a file chip in a message navigates the tree via openRequest (use-files-panel.ts).
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Sheet } from "../../components/ui/sheet";
import { WorkspaceBrowser } from "./workspace-browser";
import type { FilesPanelState } from "./use-files-panel";

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function FilesPanel({ session, panel }: { session: SessionInfo; panel: FilesPanelState }) {
  if (!panel.isDocked) {
    return (
      <Sheet
        open={panel.open}
        snap={panel.sheetSnap}
        onSnapChange={panel.setSheetSnap}
        onClose={() => panel.setOpen(false)}
        title={S.files.title}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <WorkspaceBrowser
              session={session}
              openRequest={panel.openRequest}
              active={panel.open}
              // Entering preview from list view: bump the snap point up to full (preview needs the space)
              onPreviewOpen={() => panel.setSheetSnap("full")}
            />
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      {panel.open && (
        <div
          onMouseDown={panel.startResize}
          onDoubleClick={panel.resetWidth}
          title={S.files.resizeHandle}
          className={`w-1.5 shrink-0 cursor-col-resize transition-colors duration-150 hover:bg-brand-300/50 dark:hover:bg-brand-700/40 ${
            panel.resizing ? "bg-brand-400/60" : "bg-transparent"
          }`}
        />
      )}
      <div
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
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-gray-200 dark:border-gray-800 ${
          panel.resizing ? "pointer-events-none" : "transition-[width] duration-200"
        }`}
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
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{S.files.title}</h4>
            <button
              type="button"
              onClick={() => panel.setOpen(false)}
              title={S.common.close}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <WorkspaceBrowser
              session={session}
              openRequest={panel.openRequest}
              active={panel.open}
            />
          </div>
        </div>
      </div>
    </>
  );
}
