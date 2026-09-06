/**
 * @prismshadow/penguin-plugin-claude-code — Claude Code as a session surface.
 *
 * A PLUGIN PACKAGE, not part of the harness: a deployment lists it in plugins.json and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It
 * compiles against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces and carries no runtime dependency on either.
 *
 * What it contributes is ONE surface (core plugin/surfaces.ts): a "New chat" entry named
 * "Claude Code" whose Session, once opened, is the Claude Code TUI running in that
 * Session's Workspace — in a pty the harness's own terminal manager holds, drawn by the
 * Web App's `TerminalSurface` renderer. The Session lists, titles, archives and deletes
 * like any other; what it cannot do is take a Task, since nothing here is a model.
 *
 * ## State
 *
 * A pty has no notion of "thinking", so this surface's state is a heuristic: output within
 * the last {@link ACTIVITY_WINDOW_MS} means running, silence past it means idle, exit means
 * idle. Claude Code redraws continuously while it works (its spinner) and not at all while
 * it waits for input, which is what makes the rule hold in practice. The window is this
 * plugin's judgement, not the platform's.
 *
 * ## The program
 *
 * `claude` from PATH, or whatever `PENGUIN_CLAUDE_BIN` names — the seam a deployment uses
 * for a Claude Code that is not on the server's PATH, and the one the integration test uses
 * to stand in a fake. A first prompt from the draft page becomes the program's first argument.
 *
 * ## Hot swaps
 *
 * Plugin modules are rebuilt per App; the ptys outlive the swap in the runtime's registry.
 * The Session → terminal map is parked and, at the next create, each terminal is claimed
 * back from the manager by id — one that is gone reads as never opened.
 */
import type { Json, ModuleCtx } from "@prismshadow/penguin-core/kernel";
import type {
  Plugin,
  SessionSurface,
  SurfaceOpenOptions,
  SurfaceSessionRef,
  SurfaceState,
  SurfaceView,
} from "@prismshadow/penguin-core/plugin";
import type { Terminals } from "@prismshadow/penguin-server/plugin";

/** Output within this many milliseconds of now reads as "running"; silence past it as "idle". */
export const ACTIVITY_WINDOW_MS = 1500;

/**
 * The parent's Claude Code SESSION markers, scrubbed from the pty's environment.
 *
 * A surface's pty inherits the server process's environment, and a harness started from
 * inside a Claude Code session carries that session's markers — which a child `claude`
 * reads as "I am nested": it turns transcript saving off and points its messaging at the
 * parent's socket. The Session opened here is a top-level conversation of its own, so the
 * markers go.
 *
 * Only the markers that IDENTIFY a running session are listed. Configuration a deployment
 * sets on purpose — `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, the
 * `ANTHROPIC_*` variables — is inherited untouched, which is how an operator configures
 * the tool at all.
 */
export const INHERITED_SESSION_MARKERS: readonly string[] = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
];

/** The program to run: an override for tests and off-PATH installs, else `claude`. */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PENGUIN_CLAUDE_BIN?.trim();
  return explicit ? explicit : "claude";
}

/** The argv for one Session: the program, then the first prompt when there is one. */
export function claudeArgv(
  prompt: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const argv = [claudeBinary(env)];
  const first = prompt?.trim() ?? "";
  if (first !== "") argv.push(first);
  return argv;
}

/** What the pty manager gives back; the members this surface reads of a terminal. */
type TerminalHandle = NonNullable<ReturnType<Terminals["get"]>>;

interface Tracked {
  terminal: TerminalHandle;
  state: SurfaceState;
  report: ((state: SurfaceState) => void) | null;
  quiet: ReturnType<typeof setTimeout> | null;
  unsubscribe: () => void;
}

/** The parked document: which terminal each Session's surface is. */
interface Parked {
  sessions?: Record<string, string>;
}

/**
 * The surface: one pty per Session, running Claude Code in the Workspace, with the activity
 * heuristic above as its state.
 */
export class ClaudeCodeSurface implements SessionSurface {
  private readonly tracked = new Map<string, Tracked>();

  constructor(
    private readonly terminals: Terminals,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly windowMs: number = ACTIVITY_WINDOW_MS,
  ) {}

  /** Claims back the terminals a previous App parked; a terminal that is gone is forgotten. */
  adopt(parked: Json): void {
    const sessions = (parked as Parked | null)?.sessions ?? {};
    for (const [sessionId, terminalId] of Object.entries(sessions)) {
      const terminal = this.terminals.get(terminalId);
      if (terminal === undefined || !terminal.alive) continue;
      this.track(sessionId, terminal);
    }
  }

  park(): Json {
    const sessions: Record<string, string> = {};
    for (const [sessionId, t] of this.tracked) sessions[sessionId] = t.terminal.id;
    return { sessions };
  }

  async open(
    session: SurfaceSessionRef,
    options: SurfaceOpenOptions,
    report: (state: SurfaceState) => void,
  ): Promise<SurfaceView> {
    const existing = this.tracked.get(session.sessionId);
    if (existing !== undefined && existing.terminal.alive) {
      // Idempotent: the same program, and the reporter of THIS App from now on.
      existing.report = report;
      return this.viewOf(existing);
    }
    if (existing !== undefined) this.untrack(session.sessionId);
    const terminal = await this.terminals.create({
      cwd: session.workspace,
      ownerUserId: session.ownerUserId,
      name: "claude",
      command: claudeArgv(options.prompt, this.env),
      unsetEnv: INHERITED_SESSION_MARKERS,
      ...(options.cols !== undefined ? { cols: options.cols } : {}),
      ...(options.rows !== undefined ? { rows: options.rows } : {}),
    });
    const tracked = this.track(session.sessionId, terminal);
    tracked.report = report;
    return this.viewOf(tracked);
  }

  view(sessionId: string): SurfaceView | null {
    const tracked = this.tracked.get(sessionId);
    return tracked === undefined ? null : this.viewOf(tracked);
  }

  status(sessionId: string): SurfaceState {
    return this.tracked.get(sessionId)?.state ?? "idle";
  }

  close(sessionId: string): void {
    const tracked = this.tracked.get(sessionId);
    if (tracked === undefined) return;
    if (tracked.terminal.alive) tracked.terminal.kill();
    this.untrack(sessionId);
  }

  private viewOf(tracked: Tracked): SurfaceView {
    return { alive: tracked.terminal.alive, view: { terminalId: tracked.terminal.id } };
  }

  private track(sessionId: string, terminal: TerminalHandle): Tracked {
    const tracked: Tracked = {
      terminal,
      state: "idle",
      report: null,
      quiet: null,
      unsubscribe: () => {},
    };
    const offOutput = terminal.onOutput(() => {
      this.flip(tracked, "running");
      if (tracked.quiet !== null) clearTimeout(tracked.quiet);
      tracked.quiet = setTimeout(() => {
        tracked.quiet = null;
        this.flip(tracked, "idle");
      }, this.windowMs);
      tracked.quiet.unref?.();
    });
    const offExit = terminal.onExit(() => {
      if (tracked.quiet !== null) clearTimeout(tracked.quiet);
      tracked.quiet = null;
      this.flip(tracked, "idle");
    });
    tracked.unsubscribe = () => {
      offOutput();
      offExit();
    };
    this.tracked.set(sessionId, tracked);
    return tracked;
  }

  private untrack(sessionId: string): void {
    const tracked = this.tracked.get(sessionId);
    if (tracked === undefined) return;
    if (tracked.quiet !== null) clearTimeout(tracked.quiet);
    tracked.unsubscribe();
    this.tracked.delete(sessionId);
  }

  private flip(tracked: Tracked, state: SurfaceState): void {
    if (tracked.state === state) return;
    tracked.state = state;
    tracked.report?.(state);
  }
}

/**
 * The plugin: one module, whose manifest is package.json#penguin.modules[0] (the surface
 * on the SessionSurfacesModule.surfaces slot, and Terminals as its one requirement); this
 * default export binds the surface by that contribution id.
 */
const plugin: Plugin = {
  modules: {
    ClaudeCode: {
      create: ({ use }: ModuleCtx, context: Json) => {
        const surface = new ClaudeCodeSurface(use.terminals as Terminals);
        surface.adopt(context);
        return {
          api: {},
          bind: { "claude-code.surface": surface },
          park: () => surface.park(),
        };
      },
    },
  },
};
export default plugin;
