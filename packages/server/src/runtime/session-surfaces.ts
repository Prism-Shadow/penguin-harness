/**
 * Session surfaces: the surfaces of one App, as plugins contributed them through
 * `SessionSurfacesModule.surfaces` — and the three things the harness does with one.
 *
 * A Session has a surface (core plugin/surfaces.ts): what the chat page renders for it and
 * where its idle / running state comes from. The built-in conversation is the absent
 * surface; every other kind is one contribution — the static half (`kind`, labels, the
 * renderer) is what GET /api/contributions hands the Web App, the code half is what the
 * routes below drive.
 *
 * State is the surface's own answer, and its flips are published exactly the way the
 * SessionManager publishes a run's: a `session_state` event on the user channel, with the
 * row stamped first (`markDriven` at the start, `touchLastActive` at the end), so the
 * sidebar's running and unread glyphs need no notion of a surface at all.
 *
 * A node of the tree, not a singleton, for the reason the language floor is one: a hot
 * swap builds the next App from the plugins it loaded then, so a surface whose plugin a
 * push removed stops being offered — Sessions of that kind stay listed and answer 404 on
 * their surface routes, rather than lingering half-alive.
 */
import { Hono } from "hono";
import {
  Bind,
  Component,
  Interface,
  Module,
  Provide,
  Use,
  type ClassCtx,
  type Slot,
} from "@prismshadow/penguin-core/kernel";
import type {
  SessionSurface,
  SessionSurfaceContribution,
  SurfaceOpenOptions,
  SurfaceSessionRef,
  SurfaceReport,
  SurfaceState,
  SurfaceView,
} from "@prismshadow/penguin-core/plugin";
import type { AppEnv } from "../auth/middleware.js";
import type {
  ServerEvent,
  SessionSurfaceOpenRequest,
  SessionSurfaceResponse,
  SessionSurfaceSummary,
  SessionStatus,
} from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { Clock } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import { Access, ProjectEvents } from "../mechanisms/projects.js";
import { SessionIndex } from "../mechanisms/sessions.js";
import { Sessions } from "./session-manager.js";

/** A first prompt's first line becomes the Session title, cut to what a list row can show. */
const SURFACE_TITLE_MAX = 80;

/** `sessions.surface` values: a key, never a label — it is written on every Session of the kind. */
const SURFACE_KIND = /^[a-z][a-z0-9-]*$/;

/** One contributed surface, both halves paired. */
interface Registered {
  summary: SessionSurfaceSummary;
  surface: SessionSurface;
}

export interface SessionSurfaceServiceDeps {
  sessions: SessionIndex;
  notifyProjectUsers: (projectId: string, event: ServerEvent) => void;
  /** Pushes a surface Session's state to the one status authority (the SessionManager). */
  setStatus: (sessionId: string, status: SurfaceState | null) => void;
  now: () => Date;
}

/** What this floor remembers about a Session it opened, including the last title it wrote. */
interface Opened {
  kind: string;
  projectId: string;
  /** The last title THIS floor set, or absent — what tells a program's rename from a person's. */
  titleWritten?: string;
}

export class SessionSurfaceService {
  private readonly kinds = new Map<string, Registered>();
  /** Which Sessions were opened through this service, so a flip can be attributed to a row. */
  private readonly opened = new Map<string, Opened>();
  private readonly states = new Map<string, SurfaceState>();

  constructor(
    contributed: ReadonlyArray<{
      id: string;
      from: string;
      data: SessionSurfaceContribution;
      surface: SessionSurface;
    }>,
    private readonly deps: SessionSurfaceServiceDeps,
  ) {
    for (const { id, from, data, surface } of contributed) {
      const kind = data.kind;
      if (!SURFACE_KIND.test(kind)) {
        throw new Error(`surface contribution '${id}' (${from}): kind '${kind}' is not a key`);
      }
      // Unlike a grammar, a kind is written into Session rows: two plugins claiming one
      // would make every such Session ambiguous, so this is a boot error, not "last wins".
      const taken = this.kinds.get(kind);
      if (taken !== undefined) {
        throw new Error(
          `surface kind '${kind}' is contributed twice: by ${taken.summary.from} (${taken.summary.id}) and ${from} (${id})`,
        );
      }
      this.kinds.set(kind, {
        summary: {
          id,
          from,
          kind,
          label: data.label,
          ...(data.labelZh === undefined ? {} : { labelZh: data.labelZh }),
          renderer: data.renderer,
        },
        surface,
      });
    }
  }

  /** The listing: what "New chat" offers and what the chat page draws with. */
  list(): SessionSurfaceSummary[] {
    return [...this.kinds.values()].map((r) => r.summary);
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  /** A surface Session's state: the surface's answer, `idle` before it was ever opened. */
  statusOf(sessionId: string): SessionStatus {
    const entry = this.opened.get(sessionId);
    if (entry === undefined) return "idle";
    return this.kinds.get(entry.kind)?.surface.status(sessionId) ?? "idle";
  }

  /** The surface as the routes report it; null when the row's kind is not loaded here. */
  describe(row: SessionRow): SessionSurfaceResponse | null {
    const kind = row.surface ?? null;
    if (kind === null) return null;
    const registered = this.kinds.get(kind);
    if (registered === undefined) return null;
    const view = registered.surface.view(row.sessionId);
    return {
      kind,
      status: this.statusOf(row.sessionId),
      opened: view !== null,
      alive: view?.alive ?? false,
      ...(view === null ? {} : { view: view.view }),
    };
  }

  async open(
    row: SessionRow,
    ownerUserId: string,
    options: SurfaceOpenOptions,
  ): Promise<SessionSurfaceResponse | null> {
    const kind = row.surface ?? null;
    if (kind === null) return null;
    const registered = this.kinds.get(kind);
    if (registered === undefined) return null;
    const ref: SurfaceSessionRef = {
      sessionId: row.sessionId,
      projectId: row.projectId,
      agentId: row.agentId,
      workspace: row.workspace,
      ownerUserId,
    };
    this.opened.set(row.sessionId, { kind, projectId: row.projectId });
    const view: SurfaceView = await registered.surface.open(ref, options, (state) =>
      this.report(row.sessionId, state),
    );
    // A conversation is titled by the model after its first turn; a surface has no model, so
    // the first prompt's first line is the title — once, and only where nothing named it yet.
    const firstLine = options.prompt?.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (firstLine !== "" && row.title === null) {
      const written = firstLine.slice(0, SURFACE_TITLE_MAX);
      this.deps.sessions.updateTitleIfNull(row.sessionId, written);
      // Remembered as OURS, so a program that later names the session may improve on it
      // (see applyTitle) while a person's rename ends the matter.
      const opened = this.opened.get(row.sessionId);
      if (opened !== undefined) opened.titleWritten = written;
    }
    return {
      kind,
      status: this.statusOf(row.sessionId),
      opened: true,
      alive: view.alive,
      view: view.view,
    };
  }

  close(sessionId: string): void {
    const entry = this.opened.get(sessionId);
    if (entry === undefined) return;
    this.kinds.get(entry.kind)?.surface.close(sessionId);
    this.report(sessionId, "idle");
    this.opened.delete(sessionId);
    this.states.delete(sessionId);
    this.deps.setStatus(sessionId, null);
  }

  /**
   * The program's own name for a Session, taken only while nobody better has named it.
   *
   * "Nobody better" is decided by comparison, not by a flag: this floor remembers the last
   * title it wrote, and writes again only when the row still carries it. So a program may
   * improve on the first prompt's line (Claude Code names a session once it knows what it is
   * about, and renames it as the work turns), and a person's rename ends the matter — the row
   * no longer says what this floor last wrote, so nothing here touches it again.
   */
  private applyTitle(sessionId: string, entry: Opened, title: string | undefined): void {
    const next = title?.split(/\r?\n/, 1)[0]?.trim().slice(0, SURFACE_TITLE_MAX) ?? "";
    if (next === "" || next === entry.titleWritten) return;
    let current: string | null;
    try {
      current = this.deps.sessions.findById(sessionId)?.title ?? null;
    } catch {
      return;
    }
    if (current !== null && current !== entry.titleWritten) return;
    try {
      this.deps.sessions.updateTitle(sessionId, next);
    } catch {
      // A row deleted under a still-running pty: a title is never worth a throw.
      return;
    }
    entry.titleWritten = next;
    this.deps.notifyProjectUsers(entry.projectId, {
      type: "session_title",
      sessionId,
      title: next,
    });
  }

  /**
   * A state flip, as the SessionManager publishes a run's: stamp the row (the unread glyph
   * compares `lastActiveAt` against the reader's marker; `hasTrace` is what separates
   * "finished" from "never ran"), then tell every viewer of the Project.
   */
  private report(sessionId: string, incoming: SurfaceState | SurfaceReport): void {
    const entry = this.opened.get(sessionId);
    if (entry === undefined) return;
    const state = typeof incoming === "string" ? incoming : incoming.status;
    if (typeof incoming !== "string") this.applyTitle(sessionId, entry, incoming.title);
    if (this.states.get(sessionId) === state) return;
    this.states.set(sessionId, state);
    // The SessionManager is where a Session's status is read (statusOf); a surface has no
    // entry there, so its state is pushed in rather than pulled out.
    this.deps.setStatus(sessionId, state);
    const at = this.deps.now().toISOString();
    try {
      if (state === "running") this.deps.sessions.markDriven(sessionId, at);
      else this.deps.sessions.touchLastActive(sessionId, at);
    } catch {
      // Same guard the SessionManager's flip has: a row already deleted, or a database
      // closed by shutdown while a pty outlives it. A badge is never worth a throw here.
      return;
    }
    const row = this.deps.sessions.findById(sessionId);
    if (row === null) return;
    this.deps.notifyProjectUsers(entry.projectId, {
      type: "session_state",
      sessionId,
      state,
      lastActiveAt: row.lastActiveAt,
      hasTrace: true,
    });
  }
}

/** SessionSurfaces: the mechanism SessionSurfaceService implements. */
export abstract class SessionSurfaces extends Interface<{
  list(): SessionSurfaceSummary[];
  has(kind: string): boolean;
  statusOf(sessionId: string): SessionStatus;
  describe(row: SessionRow): SessionSurfaceResponse | null;
  open(
    row: SessionRow,
    ownerUserId: string,
    options: SurfaceOpenOptions,
  ): Promise<SessionSurfaceResponse | null>;
  close(sessionId: string): void;
}>() {}

export interface SessionSurfacesSlots {
  /** One surface: its static half here, the `SessionSurface` bound by the contributor. */
  surfaces: Slot<SessionSurfaceContribution, SessionSurface>;
}

@Module({})
export class SessionSurfacesModule {
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly manager!: Sessions;
  @Use() private readonly projectEvents!: ProjectEvents;
  @Use() private readonly clock!: Clock;
  @Provide() surfaces!: SessionSurfaces;
  setup({ contributions }: ClassCtx) {
    this.surfaces = new SessionSurfaceService(
      (contributions.surfaces ?? []).map((c) => ({
        id: c.id,
        from: c.from,
        data: c.data as unknown as SessionSurfaceContribution,
        surface: c.code as SessionSurface,
      })),
      {
        sessions: this.sessions,
        setStatus: (sessionId, status) => this.manager.setSurfaceStatus(sessionId, status),
        notifyProjectUsers: (projectId, event) =>
          this.projectEvents.notifyProjectUsers(projectId, event),
        now: () => this.clock.now(),
      },
    );
  }
}

export interface SurfaceRouteDeps {
  sessions: SessionIndex;
  access: Access;
  surfaces: SessionSurfaces;
}

/**
 * GET / POST / DELETE /api/sessions/:sessionId/surface — the surface of one surface Session.
 * A Session that has none, or whose kind this process does not carry (its plugin was
 * uninstalled), answers 404 `not_a_surface_session`.
 */
export function surfaceRoutes(deps: SurfaceRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const resolve = (sessionId: string | undefined, userId: string): SessionRow => {
    const row = sessionId ? deps.sessions.findById(sessionId) : null;
    if (row === null || !deps.access.canAccess(userId, row.projectId)) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    return row;
  };
  const notASurface = () =>
    new HttpError(
      404,
      "not_a_surface_session",
      "This Session has no surface, or its surface's plugin is not loaded.",
    );

  app.get("/", (c) => {
    const row = resolve(c.req.param("sessionId"), c.var.user.userId);
    const described = deps.surfaces.describe(row);
    if (described === null) throw notASurface();
    return c.json(described satisfies SessionSurfaceResponse);
  });

  app.post("/", async (c) => {
    const row = resolve(c.req.param("sessionId"), c.var.user.userId);
    if (deps.surfaces.describe(row) === null) throw notASurface();
    const body = (await readJson(c)) as SessionSurfaceOpenRequest;
    const options: SurfaceOpenOptions = {};
    if (body.prompt !== undefined) {
      if (typeof body.prompt !== "string") {
        throw new HttpError(400, "invalid_prompt", "prompt must be a string.");
      }
      if (body.prompt.trim() !== "") options.prompt = body.prompt;
    }
    for (const key of ["cols", "rows"] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new HttpError(400, `invalid_${key}`, `${key} must be a positive integer.`);
      }
      options[key] = value as number;
    }
    const opened = await deps.surfaces.open(row, c.var.user.userId, options);
    if (opened === null) throw notASurface();
    return c.json(opened satisfies SessionSurfaceResponse);
  });

  app.delete("/", (c) => {
    const row = resolve(c.req.param("sessionId"), c.var.user.userId);
    if (deps.surfaces.describe(row) === null) throw notASurface();
    deps.surfaces.close(row.sessionId);
    return c.body(null, 204);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "SurfaceRoutes.routes",
        prefix: "/api/sessions/:sessionId/surface",
        auth: "user",
        order: 265,
      },
    ],
  },
})
export class SurfaceRoutes {
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly surfaces!: SessionSurfaces;
  @Bind("SurfaceRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = surfaceRoutes({
      sessions: this.sessions,
      access: this.access,
      surfaces: this.surfaces,
    });
  }
}
