import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import { leaveWindow, windowAt, windowInFront } from "./app-window-address";
import { closeApp, useRunningAppRecords } from "./running-apps";
import { useSystemApps, systemAppFullPage } from "./system-apps";
import { localizedText } from "./skill-use";
import { S } from "./strings";
import { useLocale } from "../state/locale";
import { useAuth } from "../state/auth";
import { useProject } from "../state/project";
import { useSessions } from "../state/sessions";
import {
  closePage,
  emptyLayout,
  placePage,
  reorderPage,
  visitPage,
  type OpenPage,
  type PageLayout,
} from "./page-layout";

import { openFullPage } from "./host-history";

interface Workspace {
  scope: number;
  accountScope: number;
  layout: PageLayout;
  current: OpenPage | null;
  focus(page: OpenPage): void;
  place(page: OpenPage, side: 0 | 1, before?: string): void;
  close(id: string): void;
  minimize(id: string): void;
  whole(page: OpenPage): void;
  fullScreen(page: OpenPage): void;
  swap(): void;
  reorder(id: string, before: string): void;
  browse(sessionId: string, agentId: string, machineId: string | null): void;
  separate(page: OpenPage): void;
}
const Context = createContext<Workspace | null>(null);
export const usePageWorkspace = () => useContext(Context);

export function PageWorkspace({ children }: { children: ReactNode }) {
  const userId = useAuth().user?.userId ?? null;
  const projectId = useProject().currentProject?.projectId ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const { sessions } = useSessions();
  const apps = useRunningAppRecords();
  const systems = useSystemApps();
  const { locale } = useLocale();
  const path = location.pathname + location.search + location.hash;
  const params = new URLSearchParams(location.search);
  const directoryAgent = params.get("workbenches");
  const win = windowInFront(location);
  const sessionId = matchPath("/chat/:sessionId", location.pathname)?.params.sessionId;
  const catalog: OpenPage = {
    id: "catalog",
    kind: "catalog",
    title: S.appCenter.title,
    path: "/apps",
  };
  const app = apps.find((entry) => entry.key === win);
  const sys = systems.find((entry) =>
    matchPath({ path: entry.path, end: false }, location.pathname),
  );
  let current: OpenPage | null = null;
  if (win)
    current = {
      id: "app:" + win,
      kind: "window",
      path,
      title: app
        ? localizedText(locale, app.shortcut.title, app.shortcut.titleZh)
        : win.split("/").at(-1)!,
    };
  else if (sessionId)
    current = {
      id: "chat:" + sessionId,
      kind: "session",
      path,
      title:
        sessions.find((row) => row.sessionId === sessionId)?.title ?? S.chat.defaultSessionTitle,
    };
  else if (location.pathname === "/apps" && directoryAgent)
    current = {
      id: "workbenches:" + directoryAgent + ":" + (params.get("machine") ?? ""),
      kind: "workbenches",
      title: S.pageWorkspace.workbenches,
      path,
    };
  else if (location.pathname === "/apps") current = { ...catalog, path };
  else if (sys)
    current = {
      id: "app:system_agent/" + sys.key,
      kind: "system",
      path,
      title: localizedText(locale, sys.title, sys.titleZh),
    };
  const [layout, setLayout] = useState<PageLayout>(() =>
    current ? visitPage(emptyLayout, current) : emptyLayout,
  );
  const ref = useRef(layout);
  ref.current = layout;
  const publish = useCallback((next: PageLayout) => {
    ref.current = next;
    setLayout(next);
  }, []);
  // Selecting a tab goes through the same leave guard as an ordinary link. Keep its
  // arrangement and any window to close pending until that history entry really arrives.
  const pending = useRef<{ to: string; token: number; layout: PageLayout; closed?: string } | null>(
    null,
  );
  const ticket = useRef(0);
  // Reset the page records when identity changes without remounting the application shell.
  // Shell dialogs and non-workspace routes own their focus and Project-scoped URL filters.
  const [lifetime, setLifetime] = useState({ userId, projectId, scope: 0, accountScope: 0 });
  if (lifetime.userId !== userId || lifetime.projectId !== projectId) {
    const accountChanged = lifetime.userId !== null && lifetime.userId !== userId;
    const changed =
      accountChanged || (lifetime.projectId !== null && lifetime.projectId !== projectId);
    setLifetime({
      userId,
      projectId,
      scope: lifetime.scope + Number(changed),
      accountScope: lifetime.accountScope + Number(accountChanged),
    });
    if (changed) {
      pending.current = null;
      setLayout(current ? visitPage(emptyLayout, current) : emptyLayout);
    }
  }
  const currentId = current?.id;
  const title = current?.title;
  useLayoutEffect(() => {
    const request = pending.current;
    const arrived =
      request?.to === path &&
      (request.token === 0 || location.state?.workspaceRequest === request.token);
    if (arrived && request) {
      pending.current = null;
      if (request.closed) closeApp(request.closed);
      publish(current ? visitPage(request.layout, current) : request.layout);
    } else if (current) {
      publish(visitPage(ref.current, current));
    }
  }, [path, location.key, currentId, title, publish]);
  function go(next: PageLayout, replace = false, closed?: string) {
    const to = next.pages.find((entry) => entry.id === next.focus)?.path ?? "/chat/new";
    if (path === to) {
      if (closed) closeApp(closed);
      publish(next);
      return;
    }
    const token = ++ticket.current;
    pending.current = { to, token, layout: next, ...(closed ? { closed } : {}) };
    void navigate(to, { replace, state: { workspaceRequest: token } });
  }
  const focus = (page: OpenPage) => go(visitPage(ref.current, page));
  const place = (page: OpenPage, side: 0 | 1, before?: string) => {
    const layout = placePage(ref.current, page, side);
    go(before ? reorderPage(layout, page.id, before) : layout);
  };
  const dismiss = (id: string, keepOpen: boolean) => {
    const before = ref.current;
    const page = before.pages.find((entry) => entry.id === id);
    if (!page) return;
    const closed = !keepOpen && page.kind === "window" ? id.slice(4) : undefined;
    const removed = closePage(before, id);
    const next = keepOpen
      ? {
          ...removed,
          pages: before.pages,
          recent: before.recent,
          minimized: [...before.minimized, id],
          right: removed.visible.length === 2 ? before.right : [],
        }
      : removed;
    if (
      currentId === id &&
      page.kind === "window" &&
      before.visible.length === 1 &&
      (keepOpen ||
        !next.focus ||
        next.pages.find((item) => item.id === next.focus)?.path ===
          (location.state?.returnTo ?? "/apps"))
    ) {
      const to =
        location.state?.returnTo ??
        next.pages.find((item) => item.id === next.focus)?.path ??
        "/apps";
      pending.current = { to, token: 0, layout: next, ...(closed ? { closed } : {}) };
      leaveWindow(navigate, location);
    } else if (currentId === id) go(next, true, closed);
    else {
      if (closed) closeApp(closed);
      publish(next);
    }
  };
  function fullScreen(page: OpenPage) {
    const record = apps.find((entry) => "app:" + entry.key === page.id);
    if (!record) return;
    const { shortcut, projectId, selectedPath } = record;
    const target =
      shortcut.system?.frame !== undefined
        ? systemAppFullPage(
            projectId,
            shortcut.workbenchId,
            windowAt(new URL(page.path, window.location.origin)),
          )
        : (selectedPath ?? shortcut.path);
    openFullPage(navigate, target, page.path, { fromWindow: currentId === page.id });
  }
  const close = (id: string) => dismiss(id, false);
  const minimize = (id: string) => dismiss(id, true);
  const whole = (page: OpenPage) =>
    go({ ...visitPage(ref.current, page), visible: [page.id], right: [] });
  const swap = () => {
    const before = ref.current;
    if (before.visible.length === 2)
      publish({
        ...before,
        visible: [...before.visible].reverse(),
        right: before.pages.map((p) => p.id).filter((id) => !before.right.includes(id)),
      });
  };
  const reorder = (id: string, before: string) => publish(reorderPage(ref.current, id, before));
  const browse = (sessionId: string, agentId: string, machineId: string | null) => {
    const params = new URLSearchParams({ workbenches: agentId });
    if (machineId) params.set("machine", machineId);
    const session = ref.current.pages.find((page) => page.id === "chat:" + sessionId);
    const base = session ? placePage(ref.current, session, 0) : ref.current;
    go(
      placePage(
        base,
        {
          id: "workbenches:" + agentId + ":" + (machineId ?? ""),
          kind: "workbenches",
          title: S.pageWorkspace.workbenches,
          path: "/apps?" + params,
        },
        1,
      ),
    );
  };
  const separate = (page: OpenPage) => {
    window.open(page.path, "_blank", "noopener");
  };
  return (
    <Context.Provider
      value={{
        layout,
        scope: lifetime.scope,
        accountScope: lifetime.accountScope,
        current,
        focus,
        place,
        whole,
        close,
        minimize,
        fullScreen,
        swap,
        reorder,
        browse,
        separate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
