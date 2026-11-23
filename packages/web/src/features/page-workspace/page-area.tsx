import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DockTabs, GlyphIcon, ICONS, ResizeHandle } from "@prismshadow/penguin-ui";
import { Outlet, useLocation, type Location } from "react-router";
import { ErrorBoundary } from "../../rescue/error-boundary";
import { RescuePanel } from "../../rescue/rescue-panel";
import { S } from "../../lib/strings";
import { PAGE_DRAG_TYPE } from "../../lib/page-layout";
import { PageSlot, useNarrow } from "../../lib/page-slot";
import { useRunningAppRecords } from "../../lib/running-apps";
import { usePageWorkspace } from "../../lib/page-workspace";
import { WorkbenchDirectory } from "./workbench-directory";

function PaneTabs({ side }: { side: 0 | 1 }) {
  const workspace = usePageWorkspace()!;
  const { layout } = workspace;
  const pages = layout.pages.filter((page) => layout.right.includes(page.id) === (side === 1));
  return (
    <div
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) event.preventDefault();
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(PAGE_DRAG_TYPE);
        const page = layout.pages.find((item) => item.id === id);
        if (!page) return;
        event.preventDefault();
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-tab-id]")
            : null;
        workspace.place(page, side, target?.dataset.tabId);
      }}
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
          onDragStart(event) {
            event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
            event.dataTransfer.effectAllowed = "move";
          },
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
  const [draggingPage, setDraggingPage] = useState(false);
  useEffect(() => {
    const start = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(PAGE_DRAG_TYPE)) setDraggingPage(true);
    };
    const end = () => setDraggingPage(false);
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
    };
  }, []);
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
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${draggingPage ? "[&_iframe]:pointer-events-none" : ""}`}
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
          <div className="absolute inset-y-0 z-sticky" style={{ left: "var(--workspace-divider)" }}>
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
