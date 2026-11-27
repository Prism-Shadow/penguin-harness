import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import { leaveWindow, pathWithAt, windowAt, windowInFront } from "./app-window-address";
import { parseSessionWorkbenchPage } from "./session-workbenches";
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
  reorderPage,
  visitPage,
  type OpenPage,
  type PageLayout,
  pageSessionId,
  scopedChatId,
} from "./page-layout";

import {
  sessionAppPair,
  sessionToolTarget,
  contextualDockPage,
  dockPageKey,
  dockPageId,
} from "./session-app-dock";
import { confirmClose } from "./dock-close-guard";
import { openFullPage, returnToHostEntry } from "./host-history";

import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { getSession } from "../api/endpoints";
import { focusSessionMachine, machineForSession } from "./session-machines";
import { toastApiError } from "./toast-api-error";
import { PageWorkspaceContext as Context, type SessionLocation } from "./page-workspace-context";

interface DockOperations {
  clearDockPages(): void;
  closeDockPage(key: string): void;
  dockActiveKey(position: "right"): string | null;
  openPanel(key: string, position: "right"): void;
}

export function PageWorkspace({ children, dock }: { children?: ReactNode; dock: DockOperations }) {
  const { clearDockPages, closeDockPage, dockActiveKey, openPanel } = dock;
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
  const toolSession = sessionToolTarget(path);
  const beside = params.get("beside") ?? toolSession;
  const fromCatalog = !!params.get("beside") && params.get("fromCatalog") === "1";
  const hostMachine = params.get("besideMachine");
  const dockProject = params.get("besideProject");
  for (const key of ["beside", "fromCatalog", "besideMachine", "besideProject"]) params.delete(key);
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
  const hostProject = params.get("project");
  const qualified =
    sessionId && hostProject && params.has("machine")
      ? scopedChatId(hostProject, params.get("machine") || null, sessionId)
      : null;
  const hosts = useRef(new Map<string, OpenPage>());
  const resourceOwners = useRef(new Map<string, NonNullable<OpenPage["resourceHost"]>>());
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
    current = (qualified && hosts.current.get(qualified)) || {
      id: qualified ?? "chat:" + sessionId,
      kind: "session",
      path: contentPath,
      title:
        (!qualified && sessions.find((row) => row.sessionId === sessionId)?.title) ||
        S.chat.defaultSessionTitle,
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
  if (fromCatalog && current) {
    current = {
      ...current,
      catalogDock: true,
      resourceHost: resourceOwners.current.get(current.id),
    };
  }
  const [layout, setLayout] = useState<PageLayout>(() =>
    current ? visitPage(emptyLayout, current) : emptyLayout,
  );
  // Attachments belong to the open window. An ordinary navigation to another Session
  // can restore its own app without transferring this Session's right-hand tab.
  // A global visit can open the same catalog or app in another folder or without
  // its dock metadata. Keep the address and ownership attached to this conversation.
  const bySession = useRef(new Map<string, OpenPage>());
  const byApp = useRef(new Map<string, { session: OpenPage; app: OpenPage }>());
  const readNumber = useRef(0);
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
      byApp.current.clear();
      hosts.current.clear();
      resourceOwners.current.clear();
      readNumber.current++;
      setLayout(current ? visitPage(emptyLayout, current) : emptyLayout);
    }
  }
  const lastScope = useRef(lifetime.scope);
  useLayoutEffect(() => {
    if (lastScope.current === lifetime.scope) return;
    lastScope.current = lifetime.scope;
    clearDockPages();
  }, [lifetime.scope]);
  const currentId = current?.id;
  const title = current?.title;
  const nativeFullScreen =
    current?.kind === "system" && location.state?.nativeAppFullScreen === current.id;
  const dockedFullScreen =
    current?.kind === "window" && location.state?.dockedFullScreen === current.id;
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
      const knownHost = hosts.current.get(current.id);
      const matchingToolHost =
        !toolSession ||
        (knownHost &&
          pageSessionId(knownHost) === beside &&
          (fromCatalog || toolSession === beside));
      if (
        beside &&
        current.kind !== "session" &&
        (fromCatalog || current.kind !== "catalog") &&
        matchingToolHost
      ) {
        const session = sessionAt(beside, current.id);
        next = paired(next, session, current);
      } else if (current.kind === "session") {
        const attached = bySession.current.get(current.id);
        if (attached) next = paired(next, current, attached);
      } else if (!nativeFullScreen && !dockedFullScreen && !toolSession) {
        byApp.current.delete(current.id);
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
      const target = new URL(pair.app.path, window.location.origin);
      target.searchParams.set("beside", pageSessionId(pair.session));
      if (pair.app.catalogDock) {
        target.searchParams.set("fromCatalog", "1");
        const owner = pair.session.sessionHost;
        if (owner) {
          target.searchParams.set("besideProject", owner.session.projectId);
          target.searchParams.set("besideMachine", owner.machineId ?? "");
        } else {
          const source = new URL(pair.session.path, window.location.origin).searchParams;
          if (source.has("project") && source.has("machine")) {
            target.searchParams.set("besideProject", source.get("project")!);
            target.searchParams.set("besideMachine", source.get("machine")!);
          }
        }
      }
      to = target.pathname + target.search + target.hash;
    }
    if (path === to) {
      if (closed) closeApp(closed);
      publish(next);
      return;
    }
    const token = ++ticket.current;
    pending.current = { to, token, layout: next, ...(closed ? { closed } : {}) };
    const maximizeTool = pair && location.state?.fullScreenSessionTool === pair.app.id;
    void navigate(to, {
      replace,
      state: {
        workspaceRequest: token,
        ...(maximizeTool && { fullScreenSessionTool: pair.app.id }),
      },
    });
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
  function sessionAt(id: string, appId: string): OpenPage {
    const known = hosts.current.get(appId);
    if (
      known &&
      pageSessionId(known) === id &&
      (!dockProject ||
        (known.sessionHost?.session.projectId === dockProject &&
          (known.sessionHost.machineId ?? "") === hostMachine))
    )
      return known;
    const path = "/chat/" + encodeURIComponent(id);
    if (fromCatalog && dockProject && hostMachine !== null) {
      const key = scopedChatId(dockProject, hostMachine || null, id);
      return (
        pageForDrag(key) ?? {
          id: key,
          kind: "session",
          title: S.chat.defaultSessionTitle,
          path: path + "?" + new URLSearchParams({ project: dockProject, machine: hostMachine }),
        }
      );
    }
    return (
      pageForDrag("chat:" + id) ?? {
        id: "chat:" + id,
        kind: "session",
        title: S.chat.defaultSessionTitle,
        path,
      }
    );
  }
  function paired(base: PageLayout, session: OpenPage, app: OpenPage): PageLayout {
    if (app.kind !== "catalog") byApp.current.set(app.id, { session, app });
    const visited = visitPage(visitPage(base, session), app);
    return {
      ...visited,
      visible: [session.id, app.id],
      focus: app.id,
    };
  }
  const pair = sessionAppPair(layout);
  useLayoutEffect(() => {
    if (pair) {
      for (const [id, attached] of bySession.current)
        if (attached.id === pair.app.id && id !== pair.session.id) bySession.current.delete(id);
      bySession.current.set(pair.session.id, pair.app);
      if (pair.app.kind !== "catalog")
        byApp.current.set(pair.app.id, { session: pair.session, app: pair.app });
    }
  }, [pair?.session.id, pair?.app]);
  const owner = pair?.session.sessionHost;
  useLayoutEffect(() => {
    if (owner) return focusSessionMachine(owner.session.sessionId, owner.machineId);
  }, [owner]);

  function openBesideSession(id: string, page: OpenPage, source?: SessionLocation) {
    const target = sessionToolTarget(page.path);
    if (target === null && !page.catalogDock) {
      go(visitPage(ref.current, page));
      return;
    }
    if (
      !id ||
      page.kind === "session" ||
      (page.kind === "catalog" && !page.catalogDock) ||
      (!page.resourceHost && target != null && target !== id)
    )
      return;
    // A directory opened from a conversation selects the resource owner, while its
    // original conversation keeps the composer, transcript and physical dock.
    const catalogSession =
      fromCatalog &&
      target &&
      source?.session &&
      (pair?.app.catalogDock && sessionToolTarget(pair.app.path) === null
        ? pair.session
        : currentId === page.id && beside
          ? sessionAt(beside, page.id)
          : undefined);
    if (
      catalogSession &&
      source?.session &&
      source.projectId === projectId &&
      source.session.projectId === projectId &&
      source.session.sessionId === target
    ) {
      const resource = {
        session: source.session,
        machineId: source.machineId,
        isolatedDraft: true,
      };
      resourceOwners.current.set(page.id, resource);
      hosts.current.set(page.id, catalogSession);
      go(
        paired(ref.current, catalogSession, { ...page, catalogDock: true, resourceHost: resource }),
        currentId === page.id,
      );
      return;
    }
    const sequence = ++readNumber.current;
    function attach(session: OpenPage) {
      if (source || session.sessionHost) {
        hosts.current.set(page.id, session);
        hosts.current.set(session.id, session);
      }
      if (pair?.app.id === page.id && pair.session.id === session.id)
        openPanel(dockPageKey(page.id), "right");
      go(paired(ref.current, session, page), target === id && currentId === page.id);
    }
    const ordinary = pageForDrag("chat:" + id);
    const path = "/chat/" + encodeURIComponent(id);
    if (!source) {
      if (target && !hosts.current.has(page.id)) {
        go(visitPage(ref.current, page));
        return;
      }
      attach(
        hosts.current.get(page.id) ??
          (pair && pageSessionId(pair.session) === id ? pair.session : ordinary) ?? {
            id: "chat:" + id,
            kind: "session",
            title: S.chat.defaultSessionTitle,
            path,
          },
      );
      return;
    }
    if (source.projectId !== projectId) return;
    const address = window.location.href;
    const scope = lastScope.current;
    const requested = source;
    function verified(session: SessionInfo) {
      if (
        sequence !== readNumber.current ||
        scope !== lastScope.current ||
        window.location.href !== address ||
        session.sessionId !== id ||
        session.projectId !== requested.projectId
      )
        return;
      const existing = ref.current.pages.find(
        (p) =>
          p.sessionHost?.session.sessionId === id &&
          p.sessionHost.machineId === requested.machineId,
      );
      const ordinaryInView =
        ordinary &&
        currentId === ordinary.id &&
        ref.current.visible.includes(ordinary.id) &&
        machineForSession(id) === requested.machineId;
      const isolatedDraft = existing?.sessionHost?.isolatedDraft ?? !ordinaryInView;
      attach({
        id:
          existing?.id ??
          (ordinaryInView
            ? ordinary.id
            : scopedChatId(requested.projectId, requested.machineId, id)),
        kind: "session",
        path: isolatedDraft
          ? path +
            "?" +
            new URLSearchParams({
              project: requested.projectId,
              machine: requested.machineId ?? "",
            })
          : path,
        title: session.title ?? S.chat.defaultSessionTitle,
        sessionHost: { session, machineId: requested.machineId, isolatedDraft },
      });
    }
    if (source.session) verified(source.session);
    else
      void getSession(id, source.machineId)
        .then(({ session }) => verified(session))
        .catch((error: unknown) => {
          if (
            sequence === readNumber.current &&
            scope === lastScope.current &&
            window.location.href === address
          )
            toastApiError(error);
        });
  }
  const focus = (page: OpenPage) => {
    if (pair && pair.app.id === page.id && pair.app.catalogDock) {
      openPanel(dockPageKey(page.id), "right");
      return;
    }
    if (pair && pair.app.id === page.id) {
      openBesideSession(pageSessionId(pair.session), page);
      return;
    }
    if (pair && pair.session.id === page.id) {
      publish({ ...ref.current, focus: page.id });
      return;
    }
    if (page.kind === "session" && pair && pair.session.id !== page.id) {
      const attached = bySession.current.get(page.id);
      if (attached) {
        go(paired(ref.current, page, attached));
        return;
      }
      go(visitPage(ref.current, page));
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
        }
      : removed;
    const pair = sessionAppPair(before);
    if (page.kind !== "session") {
      // Closed, minimized or gone, the page leaves the dock it was shown in open, as a closed
      // panel tab does: on the next tab, or on the start page when it was the last.
      closeDockPage(dockPageKey(id));
      if (!keepOpen) byApp.current.delete(id);
      for (const [sid, attached] of bySession.current)
        if (attached.id === id) bySession.current.delete(sid);
    }
    if (pair && pair.app.id === id) {
      const active = dockPageId(dockActiveKey("right") ?? "");
      const found = next.pages.find((p) => p.id === active);
      const prior =
        found &&
        (byApp.current.get(found.id)?.app ??
          (found.kind === "catalog" ? { ...found, catalogDock: true } : found));
      next = prior
        ? paired(next, pair.session, prior)
        : { ...next, visible: [pair.session.id], focus: pair.session.id };
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
    if (contextualDockPage(page.path)) {
      void navigate(page.path, { state: { fullScreenSessionTool: page.id } });
      return;
    }
    if (page.kind === "system") {
      void navigate(page.path, { state: { nativeAppFullScreen: page.id, returnTo: path } });
      return;
    }
    const record = apps.find((entry) => "app:" + entry.key === page.id);
    if (!record) return;
    const { shortcut, projectId, selectedPath } = record;
    // Either kind of app opens its full page where its window's page is.
    const at = windowAt(new URL(page.path, window.location.origin));
    const target =
      shortcut.system?.frame !== undefined
        ? systemAppFullPage(projectId, shortcut.workbenchId, at)
        : pathWithAt(selectedPath ?? shortcut.path, at);
    if (pair?.app.id === page.id) {
      // Keep both live panes; the address bar and a separately opened link still use
      // the workbench's standalone route.
      void navigate(currentId === page.id ? path : page.path, {
        mask: target,
        state: { dockedFullScreen: page.id, returnTo: path },
      });
      return;
    }
    openFullPage(navigate, target, path, { fromWindow: currentId === page.id });
  }
  // A conversation row still owns its draft, including files staged only in its composer.
  // Closing its view takes it out of the pane while the row can reopen that same composer.
  const close = (id: string) => {
    const page = ref.current.pages.find((entry) => entry.id === id);
    if (!page) return;
    if (contextualDockPage(page.path)) {
      const lifetime = lastScope.current;
      void confirmClose([dockPageKey(id)]).then((allowed) => {
        if (allowed && lastScope.current === lifetime) dismiss(id, false);
      });
    } else dismiss(id, page.kind === "session");
  };
  const minimize = (id: string) => dismiss(id, true);
  const openPage = (page: OpenPage) => {
    const docked = byApp.current.get(page.id);
    if (docked) {
      const session =
        ref.current.pages.find((entry) => entry.id === docked.session.id) ?? docked.session;
      const app = { ...docked.app, path: page.path, title: page.title };
      if (pair?.app.id === page.id && pair.session.id === session.id)
        openPanel(dockPageKey(page.id), "right");
      go(paired(ref.current, session, app));
      return;
    }
    // A bound tool renders in its authorized Session's dock. Its canonical address
    // resolves that scope even when another Session or resource currently has focus.
    if (contextualDockPage(page.path)) {
      void navigate(page.path);
      return;
    }
    go(visitPage(ref.current, page));
  };
  const reorder = (id: string, before: string) => publish(reorderPage(ref.current, id, before));
  const openAppCenterBesideSession = (id: string, source?: SessionLocation) =>
    openBesideSession(id, { ...catalog, catalogDock: true }, source);
  function openFromAppCenter(page: OpenPage, replace = false) {
    if (pair?.app.kind !== "catalog" || !pair.app.catalogDock) return false;
    hosts.current.set(page.id, pair.session);
    go(paired(ref.current, pair.session, { ...page, catalogDock: true }), replace);
    return true;
  }
  function canDockRunningApp(session: OpenPage, app: OpenPage) {
    if (session.kind !== "session" || (app.kind !== "window" && app.kind !== "system"))
      return false;
    const resource = parseSessionWorkbenchPage(app);
    if (!resource) return sessionToolTarget(app.path) === undefined;
    const id = pageSessionId(session);
    const host = session.sessionHost;
    return (
      resource.address.sessionId === id &&
      resource.address.projectId === (host?.session.projectId ?? projectId) &&
      resource.address.machineId === (host ? host.machineId : machineForSession(id))
    );
  }
  const separate = (page: OpenPage) => {
    window.open(page.path, "_blank", "noopener");
  };
  return (
    <Context.Provider
      value={{
        address: path,
        layout,
        scope: lifetime.scope,
        accountScope: lifetime.accountScope,
        current,
        pageForDrag,
        resumeDraft,
        openBesideSession,
        focus,
        openPage,
        canDockRunningApp,
        dockRunningApp: (session, app) => {
          if (!canDockRunningApp(session, app)) return;
          if (session.sessionHost) {
            hosts.current.set(app.id, session);
            hosts.current.set(session.id, session);
          }
          // The pair outlives its tab going out of sight: the dock hidden, or another tab
          // chosen. Docking the same app again changes no address, so show its tab here.
          if (pair?.app.id === app.id && pair.session.id === session.id)
            openPanel(dockPageKey(app.id), "right");
          go(paired(ref.current, session, app));
        },
        close,
        minimize,
        fullScreen,
        ...(dockedFullScreen || nativeFullScreen
          ? {
              exitFullScreen: () => {
                returnToHostEntry(navigate, location.state?.returnTo ?? path);
              },
            }
          : {}),
        reorder,
        openAppCenterBesideSession,
        openFromAppCenter,
        separate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
