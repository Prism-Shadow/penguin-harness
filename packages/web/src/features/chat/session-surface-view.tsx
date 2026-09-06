/**
 * A surface Session's page: what the chat route renders when the routed Session carries a
 * `surface` (a plugin-contributed kind, see the server's runtime/session-surfaces.ts).
 *
 * The conversation page's whole content area — message stream, composer, panels — is what
 * a surface replaces; the row stays a Session in the sidebar, with the same status glyph.
 * The surface itself is drawn by a renderer: a name from the registry below (`builtin`),
 * or the plugin's own page in an iframe. No plugin code runs here — `TerminalSurface`
 * is this build's, attaching the same terminal view the dock uses to the pty the surface
 * opened server-side.
 */
import { useCallback, useMemo, useState } from "react";
import type { SessionInfo, SessionSurfaceSummary } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { toastError } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { sessionActivity } from "../../lib/session-activity";
import { S } from "../../lib/strings";
import { surfaceLabel, useContributions } from "../../state/contributions";
import { machineForSession } from "../../lib/session-machines";
import { rememberTerminalMachine } from "../../lib/terminal-machines";
import { useLocale } from "../../state/locale";
import { useSessions } from "../../state/sessions";
import {
  TerminalView,
  probeJson,
  type TerminalInfo,
  type TerminalStatus,
} from "../terminal/terminal-view";

interface SurfaceRendererProps {
  session: SessionInfo;
  surface: SessionSurfaceSummary;
}

/**
 * The surface renderers this build carries. A contributed surface names one of these; a
 * name this table lacks renders as unavailable, never as a blank area.
 */
const SURFACE_RENDERERS: Record<string, React.ComponentType<SurfaceRendererProps>> = {
  TerminalSurface,
};

/** The names a server-contributed surface may point at (exported for tests). */
export const SURFACE_RENDERER_NAMES: ReadonlySet<string> = new Set(Object.keys(SURFACE_RENDERERS));

function Unavailable({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-sm text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}

/** The routed Session's surface, drawn by its renderer. */
export function SessionSurfaceView({ session }: { session: SessionInfo }) {
  const { surfaces } = useContributions();
  const surface = surfaces.find((s) => s.kind === session.surface);
  if (surface === undefined) return <Unavailable text={S.chat.surface.unavailable} />;
  if ("iframe" in surface.renderer) {
    const src = surface.renderer.iframe.src.replace(
      ":sessionId",
      encodeURIComponent(session.sessionId),
    );
    return <iframe title={surface.kind} src={src} className="h-full w-full border-0" />;
  }
  const Renderer = SURFACE_RENDERERS[surface.renderer.builtin];
  if (Renderer === undefined) return <Unavailable text={S.chat.surface.noRenderer} />;
  return <Renderer session={session} surface={surface} />;
}

/**
 * A program in a pty, opened by the surface: attach to the terminal it names. A Session
 * visited for the first time is opened here; one whose program ended shows its last
 * screen (while the server still holds it) and offers to open it again, and one the server
 * has already reaped is opened again on sight — there is nothing left to show of the old
 * run.
 *
 * A Session on a MACHINE opens its surface there — the surface routes follow the Session
 * (lib/session-machines.ts) — so the pty is that machine's. Recording where it lives is what
 * makes every later call about it, the byte stream included, address that machine rather
 * than this server (lib/terminal-machines.ts).
 */
function TerminalSurface({ session }: SurfaceRendererProps) {
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [detail, setDetail] = useState("");
  // Bumped to open the surface again: the terminal view remounts and `ensure` runs anew.
  const [generation, setGeneration] = useState(0);
  const sessionId = session.sessionId;

  const ensure = useCallback(
    async (cols: number, rows: number): Promise<TerminalInfo> => {
      const attach = async (terminalId: unknown): Promise<TerminalInfo | null> => {
        if (typeof terminalId !== "string") throw new Error(S.chat.surface.noTerminal);
        // Before the first call about it: the id alone is what every terminal path routes by.
        rememberTerminalMachine(terminalId, machineForSession(sessionId));
        return probeJson<TerminalInfo>(`/api/terminals/${encodeURIComponent(terminalId)}`);
      };
      const open = async () => {
        const opened = await api.openSessionSurface(sessionId, { cols, rows });
        const info = await attach(opened.view?.terminalId);
        if (info === null) throw new Error(S.chat.surface.noTerminal);
        return info;
      };
      if (generation > 0) return open();
      const state = await api.getSessionSurface(sessionId);
      if (!state.opened) return open();
      const info = await attach(state.view?.terminalId);
      return info ?? open();
    },
    [sessionId, generation],
  );

  const onStatus = useCallback((next: TerminalStatus, text: string) => {
    setStatus(next);
    setDetail(text);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TerminalView
        key={`${sessionId}:${generation}`}
        ensure={ensure}
        onStatus={onStatus}
        className="min-h-0 flex-1"
      />
      {status === "exited" || status === "error" ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400">
          <span className="min-w-0 flex-1 truncate">
            {status === "exited" ? S.chat.surface.exited : detail}
          </span>
          <Button size="sm" onClick={() => setGeneration((g) => g + 1)}>
            {S.chat.surface.restart}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The page around a surface: a thin header (title, the same activity glyph the sidebar
 * draws, the Workspace) and the surface filling the rest. The conversation page's dock and
 * panels are not here — a surface is the whole content, and a terminal surface is already
 * the thing the dock would offer.
 */
export function SurfaceSessionPage({ session }: { session: SessionInfo }) {
  const { surfaces } = useContributions();
  const { locale } = useLocale();
  const { reload } = useSessions();
  const surface = surfaces.find((s) => s.kind === session.surface);
  const title = session.title ?? (surface ? surfaceLabel(surface, locale) : session.surface);
  const activity = useMemo(
    () => sessionActivity(session.status, session.hasTrace, false),
    [session.status, session.hasTrace],
  );
  const [closing, setClosing] = useState(false);
  const close = async () => {
    setClosing(true);
    try {
      await api.closeSessionSurface(session.sessionId);
      await reload();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setClosing(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
        {activity !== null ? <SessionActivityIcon activity={activity} /> : null}
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
          {session.workspace}
        </span>
        <Button size="sm" onClick={() => void close()} disabled={closing}>
          {S.chat.surface.close}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SessionSurfaceView session={session} />
      </div>
    </div>
  );
}
