import {
  Activity,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useDockBounds, sessionAppPair, slotDomId, contextualDockPage } from "./session-app-dock";
import { PaneFocus, PageIdentity } from "./page-focus";
import { usePageWorkspace } from "./page-workspace";
import { PAGE_DRAG_TYPE } from "./page-layout";

const narrowQuery = "(max-width: 767px)";
function listen(resize: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", resize);
  return () => media.removeEventListener("change", resize);
}
export function useNarrow() {
  return useSyncExternalStore(
    listen,
    () => window.matchMedia(narrowQuery).matches,
    () => false,
  );
}

/** Positioned siblings keep their React and iframe instances when they change sides. */
export function PageSlot({
  id,
  keepRunning = false,
  children,
}: {
  id: string;
  keepRunning?: boolean;
  children: ReactNode;
}) {
  const workspace = usePageWorkspace();
  const narrow = useNarrow();
  const bounds = useDockBounds(id);
  const [dropSide, setDropSide] = useState<0 | 1 | null>(null);
  if (!workspace) return children;
  const { layout, current } = workspace;
  const page = layout.pages.find((item) => item.id === id);
  const side = layout.visible.indexOf(id);
  const fullScreen = !!workspace.exitFullScreen;
  const pair = fullScreen ? null : sessionAppPair(layout);
  const docked = pair?.app.id === id;
  const split = !pair && !narrow && !fullScreen && layout.visible.length === 2;
  const shown =
    !!current &&
    (fullScreen
      ? id === current.id
      : docked
        ? !!bounds && bounds.width > 0 && bounds.height > 0 && !contextualDockPage(pair.app.path)
        : side >= 0 && (!!pair || !narrow || id === layout.focus));
  const focused = shown && layout.focus === id;
  const style: CSSProperties =
    docked && bounds
      ? {
          left: bounds.left,
          top: bounds.top,
          right: "auto",
          bottom: "auto",
          width: bounds.width,
          height: bounds.height,
          zIndex: 1,
        }
      : split
        ? {
            left: side === 1 ? "var(--workspace-divider)" : 0,
            right: side === 1 ? 0 : "calc(100% - var(--workspace-divider))",
            top: "var(--workspace-tabs-height)",
          }
        : {};
  const activate = () => {
    if (page && shown && !focused) workspace.focus(page);
  };
  return (
    <div
      id={slotDomId(id)}
      data-workspace-page={id}
      data-pane={
        shown
          ? pair
            ? docked
              ? "right"
              : "left"
            : split
              ? side === 1
                ? "right"
                : "left"
              : "full"
          : undefined
      }
      className={`absolute inset-0 min-w-0 ${shown ? "" : "invisible"}`}
      inert={!shown}
      style={style}
      onPointerDownCapture={activate}
      onFocusCapture={activate}
      onDragOver={(event) => {
        if (!shown || narrow || !event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        setDropSide(
          split ? (side === 1 ? 1 : 0) : event.clientX - box.left < box.width / 2 ? 0 : 1,
        );
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropSide(null);
      }}
      onDrop={(event) => {
        const dragged = workspace.pageForDrag(event.dataTransfer.getData(PAGE_DRAG_TYPE));
        if (dragged && dropSide !== null) {
          event.preventDefault();
          workspace.place(dragged, dropSide);
        }
        setDropSide(null);
      }}
    >
      <PageIdentity.Provider value={page}>
        <PaneFocus.Provider value={focused}>
          {keepRunning ? (
            children
          ) : (
            <Activity mode={shown ? "visible" : "hidden"}>{children}</Activity>
          )}
        </PaneFocus.Provider>
      </PageIdentity.Provider>
      {shown && dropSide !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 z-drag-preview border-2 border-accent bg-accent/10 ${split ? "inset-x-0" : dropSide === 0 ? "left-0 w-1/2" : "right-0 w-1/2"}`}
        />
      )}
    </div>
  );
}
