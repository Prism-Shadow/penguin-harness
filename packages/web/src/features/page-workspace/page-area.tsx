import {
  Activity,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DockTabs, GlyphIcon, ICONS, ResizeHandle } from "@prismshadow/penguin-ui";
import { Outlet, useLocation, type Location } from "react-router";
import { ErrorBoundary } from "../../rescue/error-boundary";
import { RescuePanel } from "../../rescue/rescue-panel";
import { S } from "../../lib/strings";
import { PaneFocus } from "../../lib/page-focus";
import { useRunningAppRecords } from "../../lib/running-apps";
import { usePageWorkspace } from "./context";
import { WorkbenchDirectory } from "./workbench-directory";
import { PAGE_DRAG_TYPE } from "./pages";

const narrowQuery = "(max-width: 767px)";
function listen(resize: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", resize);
  return () => media.removeEventListener("change", resize);
}
function useNarrow() {
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
  const [dropSide, setDropSide] = useState<0 | 1 | null>(null);
  if (!workspace) return children;
  const { layout, current } = workspace;
  const page = layout.pages.find((item) => item.id === id);
  const side = layout.visible.indexOf(id);
  const split = !narrow && layout.visible.length === 2;
  const shown = !!current && side >= 0 && (!narrow || id === layout.focus);
  const focused = shown && layout.focus === id;
  const style: CSSProperties = split
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
      data-workspace-page={id}
      data-pane={shown ? (split ? (side === 1 ? "right" : "left") : "full") : undefined}
      className={`absolute inset-0 min-w-0 bg-canvas ${shown ? "" : "invisible pointer-events-none"}`}
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
        const dragged = layout.pages.find(
          (item) => item.id === event.dataTransfer.getData(PAGE_DRAG_TYPE),
        );
        if (dragged && dropSide !== null) {
          event.preventDefault();
          workspace.place(dragged, dropSide);
        }
        setDropSide(null);
      }}
    >
      <PaneFocus.Provider value={focused}>
        {keepRunning ? (
          children
        ) : (
          <Activity mode={shown ? "visible" : "hidden"}>{children}</Activity>
        )}
      </PaneFocus.Provider>
      {shown && dropSide !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 z-10 border-2 border-accent bg-accent/10 ${split ? "inset-x-0" : dropSide === 0 ? "left-0 w-1/2" : "right-0 w-1/2"}`}
        />
      )}
    </div>
  );
}

function PaneTabs({ side }: { side: 0 | 1 }) {
  const workspace = usePageWorkspace()!;
  const { layout } = workspace;
  const pages = layout.pages.filter((page) => layout.right.includes(page.id) === (side === 1));
  return (
    <div
      className="absolute top-0 flex min-w-0 items-center border-b border-line bg-surface-muted px-1"
      style={{
        height: "var(--workspace-tabs-height)",
        left: side === 1 ? "var(--workspace-divider)" : 0,
        right: side === 1 ? 0 : "calc(100% - var(--workspace-divider))",
      }}
    >
      <DockTabs
        aria-label={S.pageWorkspace.panePages}
        tabs={pages.map((page) => ({
          key: page.id,
          label: page.title,
          glyph: (
            <GlyphIcon
              d={page.kind === "session" ? ICONS.bubbleLines : ICONS.appWindow}
              size={14}
            />
          ),
          closeLabel: S.common.close,
        }))}
        active={layout.visible[side]!}
        onSelect={(id) => {
          const page = pages.find((item) => item.id === id);
          if (page) workspace.focus(page);
        }}
        onClose={(id) => workspace.close(id)}
      />
    </div>
  );
}

export function PageArea({
  renderRoute,
  layers,
}: {
  renderRoute: (location: string | Location) => ReactNode;
  layers: ReactNode;
}) {
  const workspace = usePageWorkspace()!;
  const location = useLocation();
  const apps = useRunningAppRecords();
  const narrow = useNarrow();
  const root = useRef<HTMLElement>(null);
  const [divider, setDivider] = useState(50);
  const { current, layout } = workspace;
  const split = !!current && !narrow && layout.visible.length === 2;
  // A pointer landing inside a live frame transfers focus to its browsing context, so
  // its pointer event never reaches the wrapper in this document.
  useEffect(() => {
    const onBlur = () => {
      window.setTimeout(() => {
        const target = document.activeElement;
        if (!(target instanceof HTMLIFrameElement)) return;
        const id = target.closest<HTMLElement>("[data-pane][data-workspace-page]")?.dataset
          .workspacePage;
        const page = layout.pages.find((item) => item.id === id);
        if (page && page.id !== layout.focus) workspace.focus(page);
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [workspace, layout]);
  const resize = (ratio: number) => setDivider(Math.max(25, Math.min(75, ratio)));
  const here = location.pathname + location.search + location.hash;
  const pages = layout.pages.filter(
    (page) =>
      page.kind !== "window" ||
      (current?.id === page.id && !apps.some((app) => "app:" + app.key === page.id)),
  );
  return (
    <main
      ref={root}
      data-page-viewport
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      style={
        { "--workspace-divider": divider + "%", "--workspace-tabs-height": "2rem" } as CSSProperties
      }
    >
      {!current && (
        <ErrorBoundary key={location.pathname} fallback={(error) => <RescuePanel error={error} />}>
          <Outlet />
        </ErrorBoundary>
      )}
      {pages.map((page) => (
        <PageSlot key={page.id} id={page.id}>
          <ErrorBoundary fallback={(error) => <RescuePanel error={error} />}>
            {page.kind === "workbenches" ? (
              <WorkbenchDirectory path={page.path} />
            ) : (
              renderRoute(page.path === here ? location : page.path)
            )}
          </ErrorBoundary>
        </PageSlot>
      ))}
      {layers}
      {split && (
        <>
          <PaneTabs side={0} />
          <PaneTabs side={1} />
          <div className="absolute inset-y-0 z-10" style={{ left: "var(--workspace-divider)" }}>
            <ResizeHandle
              axis="x"
              label={S.pageWorkspace.resize}
              edge="start"
              value={divider}
              min={25}
              max={75}
              onReset={() => resize(50)}
              onStep={(delta) => resize(divider + delta / 4)}
              onResize={(event) => {
                const box = root.current?.getBoundingClientRect();
                if (box?.width) resize((100 * (event.clientX - box.left)) / box.width);
              }}
            />
          </div>
        </>
      )}
    </main>
  );
}
