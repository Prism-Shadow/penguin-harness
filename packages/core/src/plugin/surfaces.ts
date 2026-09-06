/**
 * The session-surface vocabulary a plugin compiles against — types only.
 *
 * A Session has a SURFACE: what the chat page renders for it, and where its idle / running
 * state comes from. The built-in surface is the OmniMessage conversation. A plugin adds
 * another one as a single contribution to the harness's `SessionSurfacesModule.surfaces`
 * slot: the static half below is what the Web App needs to offer it ("New chat" entry, the
 * renderer that draws it), the code half is what the harness calls when a Session of that
 * kind is opened, asked about, or closed.
 *
 * A surface Session is a Session in every other respect — listed, titled, archived,
 * deleted like the rest — but it carries no model reference and no core Session: the
 * harness never drives it. Its state is the surface's own answer, and what "running" means
 * is the surface's decision (a program in a pty is running while it produces output).
 */
import type { JsonObject } from "../kernel/index.js";

/** How the Web App draws something: a renderer from its own registry, or a page of the plugin's. */
export type SurfaceRendererRef = { builtin: string } | { iframe: { src: string } };

/** The static half of one contributed surface: what the App needs BEFORE a Session of this kind exists. */
export interface SessionSurfaceContribution {
  /** The surface's key, written on every Session of this kind (`sessions.surface`); `^[a-z][a-z0-9-]*$`. */
  kind: string;
  /** What the "New chat" entry says. */
  label: string;
  /** The same, for a Chinese interface; absent = `label`. */
  labelZh?: string;
  /**
   * Which renderer draws a Session of this kind. `builtin` names one in the App's surface
   * registry (`TerminalSurface` attaches a terminal view to `view.terminalId`); `iframe`
   * loads the plugin's own page, `:sessionId` in `src` replaced by the Session id.
   */
  renderer: SurfaceRendererRef;
}

/** The Session a surface is asked to open, as the harness knows it. */
export interface SurfaceSessionRef {
  sessionId: string;
  projectId: string;
  agentId: string;
  /** The Session's Workspace: an absolute directory on this server. */
  workspace: string;
  /** The user opening the Session; what a pty is owned by. */
  ownerUserId: string;
}

export interface SurfaceOpenOptions {
  /** A first prompt the user typed on the draft page, if any. */
  prompt?: string;
  cols?: number;
  rows?: number;
}

/** What the renderer gets: whether the surface is live, and the document it draws from. */
export interface SurfaceView {
  alive: boolean;
  /** Renderer-specific; `TerminalSurface` reads `{ terminalId: string }`. */
  view: JsonObject;
}

export type SurfaceState = "idle" | "running";

/**
 * The code half: one object per contribution, bound by its id. `open` is idempotent — a
 * Session whose surface is already live gets that same view back — and `report` is how the
 * surface tells the harness its state flipped; the harness publishes the flip to every
 * viewer and stamps the Session's activity from it.
 */
export interface SessionSurface {
  open(
    session: SurfaceSessionRef,
    options: SurfaceOpenOptions,
    report: (state: SurfaceState) => void,
  ): Promise<SurfaceView>;
  /** The current view, or null when this Session's surface was never opened (or is gone). */
  view(sessionId: string): SurfaceView | null;
  status(sessionId: string): SurfaceState;
  /** Ends the surface: the Session is being deleted, or the user closed it. */
  close(sessionId: string): void;
}
