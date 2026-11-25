import { useEffect, useRef, type ReactNode } from "react";
import { Outlet, useLocation, type Location } from "react-router";
import { ErrorBoundary } from "../../rescue/error-boundary";
import { RescuePanel } from "../../rescue/rescue-panel";
import { S } from "../../lib/strings";
import { PageSlot } from "../../lib/page-slot";
import { useRunningAppRecords } from "../../lib/running-apps";
import { usePageWorkspace } from "../../lib/page-workspace-context";
import { ScopedChat } from "./scoped-chat";
import { WorkbenchExitBall } from "../workbenches";
import { useAppDockDrop } from "./app-dock-drop";
import { WorkbenchDirectory } from "./workbench-directory";

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
  const appDrop = useAppDockDrop();
  const { current, layout } = workspace;
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
  const here = location.pathname + location.search + location.hash;
  const pages = layout.pages.filter(
    (page) =>
      page.kind !== "window" ||
      (current?.id === page.id && !apps.some((app) => "app:" + app.key === page.id)),
  );
  return (
    <main
      data-page-viewport
      {...appDrop.events}
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${appDrop.draggingId ? "[&_iframe]:pointer-events-none" : ""}`}
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
      {appDrop.indicator}
      {workspace.exitFullScreen && (
        <WorkbenchExitBall
          label={S.workbenches.exitFullPageButton}
          onExit={workspace.exitFullScreen}
        />
      )}
    </main>
  );
}
