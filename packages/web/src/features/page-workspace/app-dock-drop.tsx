import { useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { pageSessionId, PAGE_DRAG_TYPE } from "../../lib/page-layout";
import { usePageWorkspace } from "../../lib/page-workspace";
import { sessionAppPair, sessionToolTarget, slotDomId } from "../../lib/session-app-dock";

/** During dragover the data store is protected. The ID was readable at the native dragstart. */
export function useAppDockDrop(narrow: boolean) {
  const workspace = usePageWorkspace()!;
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const [draggingId, setDraggingId] = useState("");
  useEffect(() => {
    const start = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(PAGE_DRAG_TYPE)) {
        setPreview(null);
        setDraggingId(event.dataTransfer.getData(PAGE_DRAG_TYPE));
      }
    };
    const end = () => {
      setPreview(null);
      setDraggingId("");
    };
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
    };
  }, []);
  const app = draggingId ? workspace.pageForDrag(draggingId) : undefined;
  function receive(event: ReactDragEvent<HTMLElement>, dropping: boolean) {
    if (
      !app ||
      (app.kind !== "window" && app.kind !== "system") ||
      narrow ||
      workspace.exitFullScreen
    )
      return;
    const slot = (event.target as Element).closest<HTMLElement>("[data-workspace-page][data-pane]");
    const hovered = workspace.layout.pages.find((item) => item.id === slot?.dataset.workspacePage);
    const pair = sessionAppPair(workspace.layout);
    const session =
      hovered?.kind === "session"
        ? hovered
        : pair && hovered?.id === pair.app.id
          ? pair.session
          : null;
    if (!session) {
      setPreview(null);
      return;
    }
    // A running app belongs to this conversation's physical right dock. The generic
    // half-page targets below this listener still handle ordinary page-to-page splits.
    event.stopPropagation();
    const root = document.getElementById(slotDomId(session.id));
    const row = root?.querySelector<HTMLElement>("[data-dock-row]");
    const area = row?.closest<HTMLElement>("[data-dock-area]");
    const preferred = Number(area?.dataset.rightDockWidth);
    const target = sessionToolTarget(app.path);
    if (!row || !preferred || (target !== undefined && target !== pageSessionId(session))) {
      setPreview(null);
      return;
    }
    const rowBox = row.getBoundingClientRect();
    const view = event.currentTarget.getBoundingClientRect();
    const scaleX = row.offsetWidth ? rowBox.width / row.offsetWidth : 1;
    const width = Math.min(preferred * scaleX, view.width);
    const rect = new DOMRect(view.right - width, rowBox.top, width, rowBox.height);
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      setPreview(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropping) {
      setPreview(null);
      if (event.dataTransfer.getData(PAGE_DRAG_TYPE) === app.id)
        workspace.dockRunningApp(session, app);
    } else setPreview(rect);
  }
  return {
    draggingId,
    events: {
      onDragEnterCapture: (event: ReactDragEvent<HTMLElement>) => receive(event, false),
      onDragOverCapture: (event: ReactDragEvent<HTMLElement>) => receive(event, false),
      onDropCapture: (event: ReactDragEvent<HTMLElement>) => receive(event, true),
      onDragLeaveCapture: (event: ReactDragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null);
      },
    },
    indicator:
      draggingId &&
      preview &&
      createPortal(
        <div
          aria-hidden
          data-testid="session-app-drop-preview"
          className="pointer-events-none fixed z-drag-preview border-2 border-accent bg-accent/10"
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
        />,
        document.body,
      ),
  };
}
