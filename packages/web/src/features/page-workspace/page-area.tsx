import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Dropdown,
  GlyphIcon,
  IconButton,
  ICONS,
  Menu,
  MenuItem,
  ResizeHandle,
} from "@prismshadow/penguin-ui";
import { Outlet, useLocation, type Location } from "react-router";
import { ErrorBoundary } from "../../rescue/error-boundary";
import { RescuePanel } from "../../rescue/rescue-panel";
import { S } from "../../lib/strings";
import { PAGE_DRAG_TYPE } from "../../lib/page-layout";
import { sessionAppPair } from "../../lib/session-app-dock";
import { PageSlot, useNarrow } from "../../lib/page-slot";
import { useRunningAppRecords } from "../../lib/running-apps";
import { usePageWorkspace } from "../../lib/page-workspace";
import { ScopedChat } from "./scoped-chat";
import { WorkbenchDirectory } from "./workbench-directory";

function PaneHeader({ side }: { side: 0 | 1 }) {
  const workspace = usePageWorkspace()!;
  const { layout } = workspace;
  const page = layout.pages.find((item) => item.id === layout.visible[side])!;
  const [open, setOpen] = useState(false);
  const words = S.pageWorkspace;
  const name = side === 0 ? words.leftPane : words.rightPane;
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div
      role="group"
      aria-label={name}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) event.preventDefault();
      }}
      onDrop={(event) => {
        const dragged = workspace.pageForDrag(event.dataTransfer.getData(PAGE_DRAG_TYPE));
        if (dragged) {
          event.preventDefault();
          workspace.place(dragged, side);
        }
      }}
      className="absolute top-0 flex min-w-0 items-center border-b border-line bg-surface-muted px-1"
      style={{
        height: "var(--workspace-tabs-height)",
        left: side === 1 ? "var(--workspace-divider)" : 0,
        right: side === 1 ? 0 : "calc(100% - var(--workspace-divider))",
      }}
    >
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        aria-pressed={layout.focus === page.id}
        onClick={() => workspace.focus(page)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-xs hover:bg-hover"
      >
        <GlyphIcon d={page.kind === "session" ? ICONS.bubbleLines : ICONS.appWindow} size={14} />
        <span className="truncate">{page.title}</span>
      </button>
      <Dropdown
        open={open}
        setOpen={setOpen}
        portal={{ direction: "down", align: "right" }}
        button={
          <IconButton
            label={words.actions + " · " + page.title}
            size="sm"
            variant="ghost"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <GlyphIcon d={ICONS.ellipsis} size={16} />
          </IconButton>
        }
      >
        <Menu>
          <MenuItem
            glyph={ICONS.arrowUpDown}
            label={words.swap}
            onSelect={choose(workspace.swap)}
          />
          <MenuItem
            glyph={ICONS.square}
            label={words.whole}
            onSelect={choose(() => workspace.whole(page))}
          />
          <MenuItem
            glyph={ICONS.cross}
            label={
              page.kind === "window" || page.kind === "system" ? S.common.close : words.closeView
            }
            onSelect={choose(() => workspace.close(page.id))}
          />
        </Menu>
      </Dropdown>
    </div>
  );
}

/** A hidden page keeps its own history entry. DraftView uses that entry's key to
 * distinguish an explicit New chat from resuming the already-open draft. */
function PageRoute({
  path,
  active,
  location,
  renderRoute,
}: {
  path: string;
  active: boolean;
  location: Location;
  renderRoute: (location: string | Location) => ReactNode;
}) {
  const entry = useRef<Location | null>(null);
  if (active) {
    const resumeDraft = location.pathname === "/chat/new" && location.state?.workspaceRequest;
    if (!resumeDraft || !entry.current) {
      const address = new URL(path, window.location.origin);
      entry.current = {
        ...location,
        pathname: address.pathname,
        search: address.search,
        hash: address.hash,
      };
    }
  }
  return renderRoute(entry.current ?? path);
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
  const split = !!current && !narrow && layout.visible.length === 2 && !sessionAppPair(layout);
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
        <PageSlot
          key={JSON.stringify([
            page.kind === "system" ? workspace.accountScope : workspace.scope,
            page.id,
          ])}
          id={page.id}
        >
          <ErrorBoundary fallback={(error) => <RescuePanel error={error} />}>
            {page.kind === "workbenches" ? (
              <WorkbenchDirectory path={page.path} />
            ) : (
              <ScopedChat page={page}>
                <PageRoute
                  path={page.path}
                  active={page.path === here || page.id === current?.id}
                  location={location}
                  renderRoute={renderRoute}
                />
              </ScopedChat>
            )}
          </ErrorBoundary>
        </PageSlot>
      ))}
      {layers}
      {split && (
        <>
          <PaneHeader side={0} />
          <PaneHeader side={1} />
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
