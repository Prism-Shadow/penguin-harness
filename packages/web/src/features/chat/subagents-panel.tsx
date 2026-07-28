/**
 * Subagents panel shell (same docked/Sheet split as files-panel.tsx, which documents the
 * clipping-window and inert rationale in detail): on desktop (≥1024px) it docks to the right of
 * the chat with a drag-to-resize edge; on narrower viewports it becomes a bottom Sheet. Content
 * is SubagentsView (latest-Task call graph + the selected child conversation), keyed by session
 * so node selection resets on session switch.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { StreamModel } from "../../lib/omni/stream-model";
import { Sheet } from "../../components/ui/sheet";
import { SubagentsView } from "./subagents-view";
import type { StreamRenderContext } from "./message-stream";
import type { SubagentsPanelState } from "./use-subagents-panel";

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SubagentsPanel({
  session,
  panel,
  model,
  version,
  taskRunning,
  ctx,
}: {
  session: SessionInfo;
  panel: SubagentsPanelState;
  model: StreamModel;
  version: number;
  taskRunning: boolean;
  ctx: StreamRenderContext;
}) {
  const view = (
    <SubagentsView
      key={session.sessionId}
      session={session}
      model={model}
      version={version}
      taskRunning={taskRunning}
      ctx={ctx}
      focusRequest={panel.focusRequest}
      taskScope={panel.taskScope}
    />
  );

  if (!panel.isDocked) {
    return (
      <Sheet
        open={panel.open}
        snap={panel.sheetSnap}
        onSnapChange={panel.setSheetSnap}
        onClose={() => panel.setOpen(false)}
        title={S.subagentPanel.title}
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
        // Same inert + clipping-window handling as the Files panel (see files-panel.tsx).
        inert={!panel.open}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-gray-200 dark:border-gray-800 ${
          panel.resizing ? "pointer-events-none" : "transition-[width] duration-200"
        }`}
      >
        <div style={{ width: panel.width }} className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {S.subagentPanel.title}
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
