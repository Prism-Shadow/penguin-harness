/**
 * The pet's floating conversation: the menu row "聊天" opens this window over whatever page
 * the person is on, so they can ask about the app while looking at it.
 *
 * The conversation itself is the app's own chat page, in a same-origin frame of its own
 * (`/pet-chat/:sessionId`): the same `ChatPage` a session tab renders — transcript, composer,
 * model picker, approvals — not a second, thinner chat written for this window. The frame is
 * what keeps that page's navigation inside the window instead of taking the app somewhere
 * else; the window's own chrome is what adds the two things the chat page has no reason to
 * know about: the close button and the element picker.
 *
 * The picker button is above the conversation on purpose (the board's "在 chat 上方"): the
 * person points at the app, the picked element's xpath and link go into the session as a
 * message, and the assistant answers in the same conversation.
 *
 * The chrome is the pet's own. The title is the pet's name, read from the pet plugin's state
 * document; the title is also the way into the conversations the assistant already had, since
 * every open creates a Session and the person needs to get back to an older one. The window
 * has no frame line of its own — its edge is the shadow, so it reads as floating rather than
 * as a box drawn on the page — and it moves by its header and resizes from its bottom-right
 * corner.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Button,
  ChevronDown,
  ICONS,
  Dropdown,
  Menu,
  MenuLabel,
  MenuRadioItem,
  toastAttention,
} from "@prismshadow/penguin-ui";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { formatRelativeShort } from "../../lib/format";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { startPick } from "../platform-ui/picker";
import {
  PLATFORM_AGENT_ID,
  ensurePlatformChat,
  pickMessage,
  rememberPlatformSession,
} from "./pet-agent";
import type { PlatformChat } from "./pet-agent";

/** The pet plugin's package name: its state document is where the pet's own name lives. */
const PET_PACKAGE = "@penguinharness/pet";

interface PetChatState {
  open: boolean;
  status: "loading" | "ready" | "error";
  sessionId: string | null;
  error: string | null;
}

const CLOSED: PetChatState = { open: false, status: "loading", sessionId: null, error: null };

let state: PetChatState = CLOSED;
const listeners = new Set<() => void>();

function publish(next: PetChatState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): PetChatState {
  return state;
}

/** Opens the window on the Project's platform conversation, creating it on first use. */
export function openPetChat(projectId: string | null): void {
  if (projectId === null) {
    publish({ open: true, status: "error", sessionId: null, error: S.petChat.noProject });
    return;
  }
  if (state.open && state.sessionId !== null) return;
  publish({ open: true, status: "loading", sessionId: null, error: null });
  ensurePlatformChat(projectId).then(
    (chat: PlatformChat) => {
      publish({ open: true, status: "ready", sessionId: chat.sessionId, error: null });
    },
    (err: unknown) => {
      publish({
        open: true,
        status: "error",
        sessionId: null,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );
}

/** Puts the window away; the conversation stays where it is for the next open. */
export function closePetChat(): void {
  if (!state.open) return;
  publish({ ...state, open: false });
}

/** Shows another of the assistant's conversations, and remembers it for the next open. */
export function switchPetChatSession(projectId: string | null, sessionId: string): void {
  if (projectId !== null) rememberPlatformSession(projectId, sessionId);
  if (state.sessionId === sessionId) return;
  publish({ ...state, status: "ready", sessionId, error: null });
}

// Geometry -------------------------------------------------------------------------------------

/** Where the window sits and how big it is, in viewport pixels. */
interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The window's place survives a reload: it is furniture the person arranged, not transient state. */
const GEOM_KEY = "penguin.petChat.geom";
/** Below this the framed chat page stops being usable (its composer row needs the width). */
const MIN_W = 340;
const MIN_H = 300;
/** Least distance the window keeps from the viewport's edges. */
const EDGE = 8;
/** How far the first open leaves room at the bottom for the app's composer and status bar. */
const DOCK_BOTTOM = 56;

function defaultGeom(): Geom {
  const w = Math.min(420, Math.max(MIN_W, window.innerWidth - 3 * EDGE));
  const h = Math.min(560, Math.max(MIN_H, window.innerHeight - 2 * EDGE - DOCK_BOTTOM));
  return {
    w,
    h,
    x: Math.max(EDGE, window.innerWidth - w - 12),
    y: Math.max(EDGE, window.innerHeight - h - DOCK_BOTTOM),
  };
}

/** Keeps a geometry usable: inside the viewport, and never below the minimum size. */
function clampGeom(g: Geom): Geom {
  const w = Math.max(MIN_W, Math.min(g.w, window.innerWidth - 2 * EDGE));
  const h = Math.max(MIN_H, Math.min(g.h, window.innerHeight - 2 * EDGE));
  return {
    w,
    h,
    x: Math.min(Math.max(g.x, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE)),
    y: Math.min(Math.max(g.y, EDGE), Math.max(EDGE, window.innerHeight - h - EDGE)),
  };
}

function readGeom(): Geom | null {
  try {
    const raw = localStorage.getItem(GEOM_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Geom>;
    const { x, y, w, h } = parsed;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof w !== "number" ||
      typeof h !== "number" ||
      ![x, y, w, h].every((n) => Number.isFinite(n))
    ) {
      return null;
    }
    return { x, y, w, h };
  } catch {
    return null;
  }
}

function saveGeom(g: Geom): void {
  try {
    localStorage.setItem(GEOM_KEY, JSON.stringify(g));
  } catch {
    // A private-mode storage refusal costs only the remembered place.
  }
}

// The window -----------------------------------------------------------------------------------

/** The window as a whole: chrome, picker button, and the framed conversation. */
export function PetChatWindow() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { currentProject } = useProject();
  const projectRef = useRef<string | null>(currentProject?.projectId ?? null);
  projectRef.current = currentProject?.projectId ?? null;
  const [sending, setSending] = useState(false);

  // The pet's menu posts this from its own frame; the origin check is the whole authenticity
  // story (a same-origin document is already the app's own code).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== location.origin) return;
      const data = event.data as { penguin?: unknown } | null;
      if (data === null || typeof data !== "object" || data.penguin !== "pet-chat-open") return;
      openPetChat(projectRef.current);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  const pickAndSend = useCallback(async () => {
    if (current.sessionId === null || sending) return;
    setSending(true);
    try {
      const picked = await startPick(S.petChat.pickHint);
      if (picked === null) return;
      await api.postTask(current.sessionId, {
        input: [{ type: "text", text: pickMessage(picked) }],
        queueIfBusy: true,
      });
      toastAttention(S.petChat.sent);
    } catch {
      // The composer is one click away: a failed send must not close the window.
    } finally {
      setSending(false);
    }
  }, [current.sessionId, sending]);

  if (!current.open) return null;
  return (
    <PetChatFrame
      sessionId={current.sessionId}
      status={current.status}
      error={current.error}
      projectId={currentProject?.projectId ?? null}
      sending={sending}
      onPick={() => void pickAndSend()}
    />
  );
}

/** The window proper: mounted only while it is open, so its geometry resets to the screen at hand. */
function PetChatFrame({
  sessionId,
  status,
  error,
  projectId,
  sending,
  onPick,
}: {
  sessionId: string | null;
  status: PetChatState["status"];
  error: string | null;
  projectId: string | null;
  sending: boolean;
  onPick: () => void;
}) {
  const { locale } = useLocale();
  const [geom, setGeom] = useState<Geom>(() => clampGeom(readGeom() ?? defaultGeom()));
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const [petName, setPetName] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // A viewport that changed under the window (a resized browser, a rotated screen) must not
  // leave it hanging off the edge or smaller than its own content.
  useEffect(() => {
    const onResize = (): void => setGeom((g) => clampGeom(g));
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  // The title is the pet's own name, from the state document every face of the pet shares.
  // It is read again on a slow clock because renaming happens in another surface (the pet's
  // commands), not in this window.
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const { state: doc } = await api.getPluginState(PET_PACKAGE);
        const name = (doc as { pet?: { name?: unknown } } | null)?.pet?.name;
        if (alive) setPetName(typeof name === "string" ? name.trim() : "");
      } catch {
        // No state document (the plugin is not installed, or a server from before it): the
        // title falls back to the pet's default name.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // The conversation list is read when the menu opens, so it always shows where things stand.
  useEffect(() => {
    if (!menuOpen || projectId === null) return;
    let alive = true;
    api.listSessions(projectId, PLATFORM_AGENT_ID, { limit: 30, order: "activity" }, null).then(
      (page) => {
        if (alive) setSessions(page.sessions);
      },
      () => {
        if (alive) setSessions([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [menuOpen, projectId]);

  // Moving by the header: the pointer is captured there, so a drag that crosses the framed
  // page keeps arriving even though the frame is a document of its own.
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button") !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - geomRef.current.x, dy: e.clientY - geomRef.current.y };
  };

  const dragTo = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const from = drag.current;
    if (from === null) return;
    setGeom((g) => clampGeom({ ...g, x: e.clientX - from.dx, y: e.clientY - from.dy }));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    saveGeom(geomRef.current);
  };

  // Resizing from the bottom-right corner: the top-left corner stays where it is.
  const resize = useRef<Geom | null>(null);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = geomRef.current;
  };

  const resizeTo = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const from = resize.current;
    if (from === null) return;
    setGeom(clampGeom({ ...from, w: e.clientX - from.x, h: e.clientY - from.y }));
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (resize.current === null) return;
    resize.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    saveGeom(geomRef.current);
  };

  const name = petName === "" ? S.petChat.defaultName : petName;

  return (
    <div
      data-platform-ui-overlay=""
      style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl bg-surface shadow-lg"
    >
      <div
        className="flex touch-none select-none items-center gap-2 border-b border-line px-3 py-2"
        onPointerDown={startDrag}
        onPointerMove={dragTo}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Dropdown
          className="min-w-0"
          open={menuOpen}
          setOpen={setMenuOpen}
          portal={{ direction: "down", align: "left" }}
          menuClass="w-72 max-w-[calc(100vw-2rem)]"
          button={
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`${name} · ${S.petChat.sessions}`}
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex min-w-0 cursor-pointer items-center gap-1 rounded-control px-1 py-0.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-control-hover"
            >
              <span className="truncate">{name}</span>
              <ChevronDown size={12} />
            </button>
          }
        >
          <Menu density="sm" label={S.petChat.sessions}>
            <MenuLabel>{S.petChat.sessions}</MenuLabel>
            {(sessions ?? []).map((row) => (
              <MenuRadioItem
                key={row.sessionId}
                label={
                  row.title === undefined || row.title.trim() === ""
                    ? S.petChat.untitled
                    : row.title
                }
                description={formatRelativeShort(row.lastActiveAt, locale)}
                checked={row.sessionId === sessionId}
                onSelect={() => {
                  setMenuOpen(false);
                  switchPetChatSession(projectId, row.sessionId);
                }}
              />
            ))}
            {sessions !== null && sessions.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-fg-subtle">{S.petChat.noSessions}</div>
            )}
          </Menu>
        </Dropdown>
        <Button
          className="ml-auto shrink-0"
          size="xs"
          variant="secondary"
          disabled={status !== "ready" || sending}
          onClick={onPick}
        >
          {S.petChat.pick}
        </Button>
        <button
          type="button"
          className="shrink-0 cursor-pointer px-1 text-lg leading-none text-fg-muted hover:text-fg"
          aria-label={S.petChat.close}
          onClick={() => closePetChat()}
        >
          ×
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {status === "loading" && (
          <div className="p-4 text-sm text-fg-muted">{S.petChat.preparing}</div>
        )}
        {status === "error" && (
          <div className="p-4 text-sm text-tone-danger-fg">
            {S.petChat.failed}：{error ?? ""}
          </div>
        )}
        {sessionId !== null && (
          <iframe
            key={sessionId}
            title={S.petChat.title}
            src={`/pet-chat/${encodeURIComponent(sessionId)}`}
            className="h-full w-full border-0 bg-canvas"
          />
        )}
      </div>
      {/* The window's one resize grip: the bottom-right corner, the side the drag moves last. */}
      <div
        role="separator"
        aria-label={S.petChat.resize}
        className="absolute bottom-0 right-0 z-10 grid h-4 w-4 cursor-nwse-resize touch-none place-items-center text-fg-subtle"
        onPointerDown={startResize}
        onPointerMove={resizeTo}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
          <path
            d={ICONS.resizeHandle}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}
