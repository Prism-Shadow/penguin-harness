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
import { leaveWindow, windowInFront } from "../../lib/app-window-address";
import { closeApp, useRunningAppRecords } from "../../lib/running-apps";
import { useSystemApps } from "../../lib/system-apps";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useSessions } from "../../state/sessions";
import {
  closePage,
  emptyLayout,
  placePage,
  reorderPage,
  visitPage,
  type OpenPage,
  type PageLayout,
} from "./pages";

interface Workspace {
  layout: PageLayout;
  current: OpenPage | null;
  focus(page: OpenPage): void;
  place(page: OpenPage, side: 0 | 1): void;
  close(id: string): void;
  whole(page: OpenPage): void;
  swap(): void;
  reorder(id: string, before: string): void;
  browse(agentId: string, machineId: string | null): void;
  separate(page: OpenPage): void;
}
const Context = createContext<Workspace | null>(null);
export const usePageWorkspace = () => useContext(Context);

export function PageWorkspace({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessions } = useSessions();
  const apps = useRunningAppRecords();
  const systems = useSystemApps();
  const { locale } = useLocale();
  const path = location.pathname + location.search + location.hash;
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
  else if (location.pathname === "/apps" && new URLSearchParams(location.search).has("workbenches"))
    current = {
      id:
        "workbenches:" +
        new URLSearchParams(location.search).get("workbenches") +
        ":" +
        (new URLSearchParams(location.search).get("machine") ?? ""),
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
  const currentId = current?.id;
  const title = current?.title;
  useLayoutEffect(() => {
    if (current) publish(visitPage(ref.current, current));
  }, [path, currentId, title, publish]);
  function go(next: PageLayout, replace = false) {
    const page = next.pages.find((entry) => entry.id === next.focus);
    publish(next);
    const to = page?.path ?? "/chat/new";
    if (path !== to) void navigate(to, { replace });
  }
  const focus = (page: OpenPage) => go(visitPage(ref.current, page));
  const place = (page: OpenPage, side: 0 | 1) => go(placePage(ref.current, page, side));
  const close = (id: string) => {
    const before = ref.current;
    const page = before.pages.find((entry) => entry.id === id);
    if (!page) return;
    if (page.kind === "window") closeApp(id.slice(4));
    const next = closePage(before, id);
    if (
      currentId === id &&
      page.kind === "window" &&
      before.visible.length === 1 &&
      (!next.focus ||
        next.pages.find((item) => item.id === next.focus)?.path ===
          (location.state?.returnTo ?? "/apps"))
    ) {
      publish(next);
      leaveWindow(navigate, location);
    } else if (currentId === id) go(next, true);
    else publish(next);
  };
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
  const browse = (agentId: string, machineId: string | null) => {
    const params = new URLSearchParams({ workbenches: agentId });
    if (machineId) params.set("machine", machineId);
    place(
      {
        id: "workbenches:" + agentId + ":" + (machineId ?? ""),
        kind: "workbenches",
        title: S.pageWorkspace.workbenches,
        path: "/apps?" + params,
      },
      1,
    );
  };
  const separate = (page: OpenPage) => {
    window.open(page.path, "_blank", "noopener");
  };
  return (
    <Context.Provider
      value={{ layout, current, focus, place, whole, close, swap, reorder, browse, separate }}
    >
      {children}
    </Context.Provider>
  );
}
