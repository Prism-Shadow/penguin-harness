import {
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { ChatSessionContext } from "./chat-session";
import { PageIdentity } from "./page-focus";
import type { OpenPage, PageLayout } from "./page-layout";

/** Undefined is an ordinary page. A Session workbench with no target opens its Session directory. */
export function sessionToolTarget(path: string): string | null | undefined {
  const url = new URL(path, "http://localhost");
  return /^\/session-tools\/[^/]+\/?$/.test(url.pathname)
    ? url.searchParams.get("session") || null
    : undefined;
}

export function sessionAppPair(layout: PageLayout) {
  if (layout.visible.length !== 2) return null;
  const [a, b] = layout.visible.map((id) => layout.pages.find((page) => page.id === id));
  const session = a?.kind === "session" ? a : b?.kind === "session" ? b : null;
  const app = session === a ? b : a;
  return session &&
    app &&
    sessionToolTarget(app.path) !== null &&
    (app.kind === "window" || app.kind === "system" || app.kind === "workbenches")
    ? { session, app }
    : null;
}

/** Docked pages live in this browser window. A panel ID can never start with a colon. */
export const dockPageKey = (id: string) => ":" + id;
export const dockPageId = (key: string) => (key.startsWith(":") ? key.slice(1) : null);

interface ContextualPage {
  resolve(path: string): OpenPage | null;
  existingPanelId?(page: OpenPage): string | null;
  Body: ComponentType<{ page: OpenPage; sessionId: string; active: boolean }>;
}
let contextual: ContextualPage | undefined;
/** A Session tool can draw its own workbench using the surrounding Chat controller. */
export function registerSessionAppDockAdapter(adapter: ContextualPage) {
  contextual = adapter;
  return () => {
    if (contextual === adapter) contextual = undefined;
  };
}
export function existingDockPanel(page: OpenPage) {
  return contextual?.existingPanelId?.(page) ?? null;
}
export function contextualDockPage(path: string) {
  return contextual?.resolve(path) ?? null;
}

/** An archived Chat stays a stub. Only its explicitly addressed workbench receives the Session. */
export function ScopedPanelSession({ path, children }: { path?: string; children: ReactNode }) {
  const chat = useContext(ChatSessionContext);
  const host = useContext(PageIdentity)?.sessionHost;
  const value = useMemo(() => {
    if (
      !chat ||
      chat.selected ||
      !host?.session.archived ||
      !path ||
      sessionToolTarget(path) !== host.session.sessionId ||
      chat.projectId !== host.session.projectId
    )
      return chat;
    const query = new URL(path, "http://localhost").searchParams;
    return query.get("project") === host.session.projectId &&
      (query.get("machine") || null) === host.machineId
      ? { ...chat, selected: host.session }
      : chat;
  }, [chat, host, path]);
  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

interface DockBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
const bounds = new Map<string, DockBounds>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  for (const notify of listeners) notify();
}
export function useDockBounds(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => bounds.get(id) ?? null,
    () => null,
  );
}
export const slotDomId = (id: string) => "workspace-page-" + encodeURIComponent(id);

function DockAppAnchor({ id, active }: { id: string; active: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    const host = element?.closest<HTMLElement>("[data-page-viewport]");
    if (!element || !host || !active) return;
    function measure() {
      const rect = element!.getBoundingClientRect();
      const root = host!.getBoundingClientRect();
      const next = {
        left: rect.left - root.left,
        top: rect.top - root.top,
        width: rect.width,
        height: rect.height,
      };
      const before = bounds.get(id);
      if (
        before &&
        next.left === before.left &&
        next.top === before.top &&
        next.width === before.width &&
        next.height === before.height
      )
        return;
      bounds.set(id, next);
      changed();
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      bounds.delete(id);
      changed();
    };
  }, [id, active]);
  return (
    <div
      ref={anchor}
      className="h-full min-h-0 w-full"
      aria-owns={active ? slotDomId(id) : undefined}
    />
  );
}

export function SessionAppDockBody({
  page,
  sessionId,
  active,
}: {
  page: OpenPage;
  sessionId: string;
  active: boolean;
}) {
  if (contextual?.resolve(page.path))
    return <contextual.Body page={page} sessionId={sessionId} active={active} />;
  // Reparenting a running iframe reloads its document. Its original shell slot follows
  // the actual dock body, leaving tab navigation, scrolling and resizing to the dock.
  return <DockAppAnchor id={page.id} active={active} />;
}
