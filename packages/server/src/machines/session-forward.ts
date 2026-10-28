/**
 * Session-level requests for a Session that another machine holds (PRN-003). A request to
 * `/api/sessions/:sessionId/…` names only the Session; this server looks up the machine that
 * holds it (machines/session-index.ts) and forwards the request there the same way
 * `/server/<machineId>/api/…` does: the same identity, the same header rules, and streams over
 * the socket only (machines/proxy.ts). It adds a route and changes none: the prefix keeps
 * working, and a client that already names the machine sees no difference.
 *
 * It stands in front of the Session routes and steps aside for everything that is not its
 * business:
 *  - a Session in this server's own index belongs to this server, whatever any machine holds,
 *    so an id that a machine happened to mint as well resolves here first;
 *  - a caller who is not an admin never reaches a machine (the proxy is for admins only) and
 *    gets the Session routes' own 404, which says nothing about what exists elsewhere;
 *  - an id that no machine holds falls through to that same 404.
 *
 * Two answers are its own. 503 `not_connected` when the machine holding the Session is known
 * and not connected, with the machine in `details` so that a page can say which machine it is.
 * And 502 `machine_refused` when the machine turns this server's session away (401 or 403): a
 * client reads a 401 on a path without a machine prefix as its own sign-out (web
 * api/client.ts), and a machine's refusal must never sign anyone out of this server.
 */
import { Hono } from "hono";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { errorBody } from "../http/errors.js";
import type { Access } from "../mechanisms/projects.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { MachineEventHub } from "./event-hub.js";
import type { MachineSockets } from "./machine-sockets.js";
import { forwardToMachine } from "./proxy.js";
import type { MachinesService } from "./service.js";
import { SessionMachineIndex } from "./session-index.js";
import type { MachineCandidate } from "./session-index.js";
import { MachineSocketRelay } from "./socket-relay.js";

/** What the forward needs of the machines service. */
export type SessionForwardMachines = Pick<
  MachinesService,
  "proxyTarget" | "projectApis" | "noteApiSeen"
>;

/** The Session-level path itself, without a sub-resource: what a DELETE of the Session addresses. */
const SESSION_PATH = /^\/api\/sessions\/[^/]+\/?$/;

/** An error answer in the API's shape, naming the machine it is about. */
function machineError(
  status: number,
  code: string,
  message: string,
  machineId: string,
  alias: string | null,
): Response {
  const details = { machineId, ...(alias !== null ? { alias } : {}) };
  return Response.json(errorBody(code, message, details), { status });
}

/** The code and message of an error body in the API's shape; empty for anything else. */
function errorOf(text: string): { code?: string; message?: string } {
  try {
    const error = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } } | null)
      ?.error;
    return {
      ...(typeof error?.code === "string" ? { code: error.code } : {}),
      ...(typeof error?.message === "string" ? { message: error.message } : {}),
    };
  } catch {
    return {};
  }
}

/** The routing of Session-level requests to machines, over one generation's index and relay. */
export class SessionForward {
  constructor(
    private readonly deps: {
      machines: SessionForwardMachines;
      index: SessionMachineIndex;
      relay: MachineSocketRelay;
    },
  ) {}

  /**
   * Forwards `request` to the machine that holds `sessionId`, looking among the machines of
   * `projectIds` (the Projects the caller can open) when the index does not know it yet. Null
   * when no machine holds it; otherwise the machine's answer, or this server's own reason why
   * there is none.
   */
  async forward(
    request: Request,
    sessionId: string,
    projectIds: readonly string[],
  ): Promise<Response | null> {
    const { index, machines, relay } = this.deps;
    let fleet: Promise<MachineCandidate[]> | null = null;
    const fleetOf = () => (fleet ??= this.#fleet(projectIds));
    const place = await index.resolve(sessionId, fleetOf);
    if (place === null) return null;
    const { machineId } = place;
    const aliasOf = async () =>
      (await fleetOf()).find((machine) => machine.machineId === machineId)?.alias ?? null;

    const target = await machines.proxyTarget(machineId);
    if (target === null) {
      return machineError(
        503,
        "not_connected",
        `The machine holding session ${sessionId} is not connected.`,
        machineId,
        await aliasOf(),
      );
    }
    const pathname = new URL(request.url).pathname;
    const answer = await forwardToMachine(
      request,
      { machineId, remotePath: pathname },
      target,
      relay,
      (id, outcome) => machines.noteApiSeen(id, outcome),
    );

    if (answer.status === 401 || answer.status === 403) {
      const { message } = errorOf(await answer.text().catch(() => ""));
      return machineError(
        502,
        "machine_refused",
        `The machine holding session ${sessionId} refused this server's session (${answer.status})${
          message !== undefined ? `: ${message}` : "."
        }`,
        machineId,
        await aliasOf(),
      );
    }
    if (answer.status === 404) {
      // A Session never moves to another machine, so its own machine saying it has no such
      // Session means it was deleted there. The next request for the id asks again.
      const said = await answer.text();
      if (errorOf(said).code === "session_not_found") index.forget(sessionId, machineId);
      // The body was read whole, so the upstream's framing headers no longer describe it.
      const headers = new Headers(answer.headers);
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      return new Response(said, { status: 404, headers });
    }
    if (request.method === "DELETE" && answer.ok && SESSION_PATH.test(pathname)) {
      index.forget(sessionId, machineId);
    }
    return answer;
  }

  /** Every machine of `projectIds`, once each, with a client to its API while it is connected. */
  async #fleet(projectIds: readonly string[]): Promise<MachineCandidate[]> {
    const fleet = new Map<string, MachineCandidate>();
    for (const projectId of projectIds) {
      for (const machine of await this.deps.machines.projectApis(projectId)) {
        if (!fleet.has(machine.machineId)) fleet.set(machine.machineId, machine);
      }
    }
    return [...fleet.values()];
  }
}

/** MachineSessionForward: what the machines module provides for the forward route below. */
export abstract class MachineSessionForward extends Interface<Pick<SessionForward, "forward">>() {}

/**
 * The forward over one platform generation's socket cache and event hub: the index is fed by
 * the machines' own events, and streams ride the sockets that the proxy's streams use.
 */
export function machineSessionForward(
  machines: SessionForwardMachines,
  shared: { sockets: MachineSockets; events: MachineEventHub },
  log: (line: string) => void = () => undefined,
): SessionForward {
  const index = new SessionMachineIndex();
  shared.events.tap((machineId, data) => index.hear(machineId, data));
  return new SessionForward({ machines, index, relay: new MachineSocketRelay(log, shared) });
}

/**
 * The route group in front of the Session routes. `/:sessionId/*` matches the Session's own
 * path as well as every path under it.
 */
export function sessionForwardRoutes(deps: {
  sessions: Pick<SessionIndex, "findById">;
  access: Pick<Access, "accessibleProjectIds">;
  forward: Pick<SessionForward, "forward">;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/:sessionId/*", async (c, next) => {
    const sessionId = c.req.param("sessionId");
    const user = c.var.user;
    if (!user.isAdmin || deps.sessions.findById(sessionId) !== null) return next();
    const answer = await deps.forward.forward(
      c.req.raw,
      sessionId,
      deps.access.accessibleProjectIds(user.userId),
    );
    return answer ?? next();
  });
  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "SessionForwardRoutes.routes",
        // Ahead of every group that serves `/api/sessions` (session-api.sessions, 270).
        prefix: "/api/sessions",
        auth: "user",
        order: 268,
      },
    ],
  },
})
export class SessionForwardRoutes {
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly sessionForward!: MachineSessionForward;
  @Bind("SessionForwardRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = sessionForwardRoutes({
      sessions: this.sessionsRepo,
      access: this.access,
      forward: this.sessionForward,
    });
  }
}
