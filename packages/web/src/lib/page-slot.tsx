import { Activity, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { layer } from "@prismshadow/penguin-ui";
import { useDockBounds, sessionAppPair, slotDomId, contextualDockPage } from "./session-app-dock";
import { PaneFocus, PageIdentity } from "./page-focus";
import { usePageWorkspace } from "./page-workspace-context";

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
  const bounds = useDockBounds(id);
  if (!workspace) return children;
  const { layout, current } = workspace;
  const page = layout.pages.find((item) => item.id === id);
  const side = layout.visible.indexOf(id);
  const fullScreen = !!workspace.exitFullScreen;
  const pair = fullScreen ? null : sessionAppPair(layout);
  const docked = pair?.app.id === id;
  const shown =
    !!current &&
    (fullScreen
      ? id === current.id
      : docked
        ? !!bounds && bounds.width > 0 && bounds.height > 0 && !contextualDockPage(pair.app.path)
        : side >= 0 && (!!pair || id === layout.focus));
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
          zIndex: layer("raised"),
        }
      : {};
  const activate = () => {
    if (page && shown && !focused) workspace.focus(page);
  };
  return (
    <div
      id={slotDomId(id)}
      data-workspace-page={id}
      data-pane={shown ? (pair ? (docked ? "right" : "left") : "full") : undefined}
      className={`absolute inset-0 min-w-0 ${shown ? "" : "invisible"}`}
      inert={!shown}
      style={style}
      onPointerDownCapture={activate}
      onFocusCapture={activate}
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
    </div>
  );
}
