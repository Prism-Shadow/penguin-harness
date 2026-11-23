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

import { sessionAppPair, contextualDockPage, dockPageKey, dockPageId } from "./session-app-dock";
import { detachDockPage, dockActiveKey, openPanel } from "../features/dock/dock-state";
import { openFullPage } from "./host-history";

export interface Workspace {
  scope: number;
  accountScope: number;
  layout: PageLayout;
  current: OpenPage | null;
  pageForDrag(id: string): OpenPage | undefined;
  resumeDraft(): boolean;
  openBesideSession(sessionId: string, page: OpenPage): void;
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
  const beside = params.get("beside");
  params.delete("beside");
  const contentPath =
    location.pathname + (params.size ? "?" + params.toString() : "") + location.hash;
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
      path: contentPath,
      title: app
        ? localizedText(locale, app.shortcut.title, app.shortcut.titleZh)
        : win.split("/").at(-1)!,
    };
  else if (sessionId)
    current = {
      id: "chat:" + sessionId,
      kind: "session",
      path: contentPath,
      title:
        sessions.find((row) => row.sessionId === sessionId)?.title ?? S.chat.defaultSessionTitle,
    };
  else if (location.pathname === "/apps" && directoryAgent)
    current = {
      id: "workbenches:" + directoryAgent + ":" + (params.get("machine") ?? ""),
      kind: "workbenches",
      title: S.pageWorkspace.workbenches,
      path: contentPath,
    };
  else if (location.pathname === "/apps") current = { ...catalog, path: contentPath };
  else if (contextualDockPage(contentPath)) current = contextualDockPage(contentPath);
  else if (sys)
    current = {
      id: "app:system_agent/" + sys.key,
      kind: "system",
      path: contentPath,
      title: localizedText(locale, sys.title, sys.titleZh),
    };
  const [layout, setLayout] = useState<PageLayout>(() =>
    current ? visitPage(emptyLayout, current) : emptyLayout,
  );
  // Attachments belong to the open window. An ordinary navigation to another Session
  // can restore its own app without transferring this Session's right-hand tab.
  const bySession = useRef(new Map<string, string>());
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
      bySession.current.clear();
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
      publish(
        sessionAppPair(request.layout)
          ? request.layout
          : current
            ? visitPage(request.layout, current)
            : request.layout,
      );
    } else if (current) {
      let next = visitPage(ref.current, current);
      if (beside && current.kind !== "session" && current.kind !== "catalog") {
        const session = pageForDrag("chat:" + beside) ?? {
          id: "chat:" + beside,
          kind: "session" as const,
          title: S.chat.defaultSessionTitle,
          path: "/chat/" + encodeURIComponent(beside),
        };
        next = paired(next, session, current);
      } else if (current.kind === "session") {
        const attached = next.pages.find((p) => p.id === bySession.current.get(current.id));
        if (attached) next = paired(next, current, attached);
        else if (sessionAppPair(next))
          next = { ...next, visible: [current.id], focus: current.id, right: [] };
      }
      publish(next);
    }
  }, [path, location.key, currentId, title, publish]);
  function go(next: PageLayout, replace = false, closed?: string) {
    // The last open draft already occupies /chat/new. Dismissing it must reveal another surface.
    const fallback =
      currentId === "chat:new" || next.minimized.includes("chat:new") ? "/apps" : "/chat/new";
    const pair = sessionAppPair(next);
    let to = next.pages.find((entry) => entry.id === next.focus)?.path ?? fallback;
    if (pair) {
      next = {
        ...next,
        visible: [pair.session.id, pair.app.id],
        right: [...new Set([...next.right.filter((id) => id !== pair.session.id), pair.app.id])],
      };
      const target = new URL(pair.app.path, window.location.origin);
      target.searchParams.set("beside", pair.session.id.slice(5));
      to = target.pathname + target.search + target.hash;
    }
    if (path === to) {
      if (closed) closeApp(closed);
      publish(next);
      return;
    }
    const token = ++ticket.current;
    pending.current = { to, token, layout: next, ...(closed ? { closed } : {}) };
    void navigate(to, { replace, state: { workspaceRequest: token } });
  }
  function pageForDrag(id: string): OpenPage | undefined {
    const open = ref.current.pages.find((page) => page.id === id);
    if (open) return open;
    const session = sessions.find((row) => "chat:" + row.sessionId === id);
    if (session)
      return {
        id,
        kind: "session",
        title: session.title ?? S.chat.defaultSessionTitle,
        path: "/chat/" + encodeURIComponent(session.sessionId),
      };
  }
  function paired(base: PageLayout, session: OpenPage, app: OpenPage): PageLayout {
    const visited = visitPage(visitPage(base, session), app);
    return {
      ...visited,
      visible: [session.id, app.id],
      right: [...new Set([...base.right.filter((id) => id !== session.id), app.id])],
      focus: app.id,
    };
  }
  const pair = sessionAppPair(layout);
  useLayoutEffect(() => {
    if (pair) {
      for (const [id, attached] of bySession.current)
        if (attached === pair.app.id && id !== pair.session.id) bySession.current.delete(id);
      bySession.current.set(pair.session.id, pair.app.id);
    }
  }, [pair?.session.id, pair?.app.id]);
  function openBesideSession(id: string, page: OpenPage) {
    if (!id || page.kind === "session" || page.kind === "catalog") return;
    // Archived and child Sessions need not have a row in the active sidebar.
    const session =
      pageForDrag("chat:" + id) ??
      ({
        id: "chat:" + id,
        kind: "session",
        title: S.chat.defaultSessionTitle,
        path: "/chat/" + encodeURIComponent(id),
      } as OpenPage);
    if (pair?.app.id === page.id && pair.session.id === session.id)
      openPanel(dockPageKey(page.id), "right");
    go(paired(ref.current, session, page));
  }
  const focus = (page: OpenPage) => {
    if (pair && pair.app.id === page.id) {
      openBesideSession(pair.session.id.slice(5), page);
      return;
    }
    if (pair && pair.session.id === page.id) {
      publish({ ...ref.current, focus: page.id });
      return;
    }
    if (page.kind === "session" && pair && pair.session.id !== page.id) {
      const attached = ref.current.pages.find((p) => p.id === bySession.current.get(page.id));
      if (attached) {
        go(paired(ref.current, page, attached));
        return;
      }
      const next = visitPage(ref.current, page);
      go({ ...next, visible: [page.id], right: [] });
      return;
    }
    go(visitPage(ref.current, page));
  };
  const resumeDraft = () => {
    const draft = ref.current.pages.find((page) => page.id === "chat:new");
    if (!draft || currentId === draft.id) return false;
    focus(draft);
    return true;
  };
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
    let next = keepOpen
      ? {
          ...removed,
          pages: before.pages,
          recent: before.recent,
          minimized: [...before.minimized, id],
          right: removed.visible.length === 2 ? before.right : [],
        }
      : removed;
    const pair = sessionAppPair(before);
    if (page.kind !== "session") {
      detachDockPage(dockPageKey(id));
      for (const [sid, attached] of bySession.current)
        if (attached === id) bySession.current.delete(sid);
    }
    if (pair && pair.app.id === id) {
      const active = dockPageId(dockActiveKey("right") ?? "");
      const prior = next.pages.find((p) => p.id === active);
      next = prior
        ? paired(next, pair.session, prior)
        : { ...next, visible: [pair.session.id], focus: pair.session.id, right: [] };
      go(next, true, closed);
      return;
    }
    // A workspace restore owns its return layout. Only an App Center launch or direct
    // window address should traverse the launcher's host history when dismissed.
    if (
      currentId === id &&
      page.kind === "window" &&
      location.state?.workspaceRequest == null &&
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
    openFullPage(navigate, target, pair?.app.id === page.id ? path : page.path, {
      fromWindow: currentId === page.id,
    });
  }
  // A conversation row still owns its draft, including files staged only in its composer.
  // Closing its view takes it out of the pane while the row can reopen that same composer.
  const close = (id: string) =>
    dismiss(
      id,
      ref.current.pages.some((page) => page.id === id && page.kind === "session"),
    );
  const minimize = (id: string) => dismiss(id, true);
  const whole = (page: OpenPage) => {
    if (pair) {
      detachDockPage(dockPageKey(pair.app.id));
      bySession.current.delete(pair.session.id);
    }
    go({ ...visitPage(ref.current, page), visible: [page.id], right: [] });
  };
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
    openBesideSession(sessionId, {
      id: "workbenches:" + agentId + ":" + (machineId ?? ""),
      kind: "workbenches",
      title: S.pageWorkspace.workbenches,
      path: "/apps?" + params,
    });
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
        pageForDrag,
        resumeDraft,
        openBesideSession,
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
