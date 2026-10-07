/**
 * The `/api/amsp/v1` gate: who a request is for, and whether it may be made — decided before the
 * body is read. In order:
 *
 * 1. the admin switch: off answers every request 403 `agent_api_disabled` (the CORS preflight
 *    is answered before this gate runs);
 * 2. the path names an Agent (`/agents/:projectId/:agentId…`) or an API Session
 *    (`/sessions/:sessionId…`): an invalid id, an Agent whose API switch is off or that does not
 *    exist, a Session no API run created, or one whose Agent's switch is off, is a 404 that says
 *    nothing about which of these it was;
 * 3. the caller: an `Authorization` header must carry a key of that Agent — an unknown key is
 *    401, another Agent's key the same 404 as an unknown Agent (or Session); no header at all is
 *    accepted only when the Agent allows keyless access, 401 otherwise.
 *
 * Any other path under the prefix passes through untouched, to the group's 404 tail.
 */
import { isValidId } from "@prismshadow/penguin-core";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { bearerToken } from "../auth/middleware.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { HttpError } from "../http/errors.js";
import type { AgentApi, AgentApiRow } from "../mechanisms/agent-api.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { Settings } from "../mechanisms/settings.js";
import { hashAgentApiKey } from "./keys.js";

/** What the gate resolved a request to: the Agent it is for, the key it presented, the Session it names. */
export interface AmspContext {
  projectId: string;
  agentId: string;
  /** The key that authenticated the request; null for a keyless request to an open Agent. */
  keyId: string | null;
  /** The API Session a `/sessions/:sessionId…` path names; null on an Agent path. */
  session: SessionRow | null;
}

/** The group's Hono env: the app's, plus the gate's resolution. */
export type AmspEnv = { Variables: AppEnv["Variables"] & { amsp: AmspContext } };

export interface AmspGateDeps {
  settings: Pick<Settings, "getAgentApiEnabled">;
  agentApi: AgentApi;
  sessions: Pick<SessionIndex, "findById">;
  agentConfig: Pick<AgentConfig, "exists">;
}

/** One answer for an Agent that does not exist, is not exposed, or is not the key's. */
export const agentNotFound = (): HttpError =>
  new HttpError(404, "agent_not_found", "No Agent with this id has its API enabled.");

/** One answer for a Session that does not exist, is not an API Session, or is not the key's Agent's. */
export const sessionNotFound = (): HttpError =>
  new HttpError(404, "session_not_found", "No API Session with this id.");

const unauthorized = (message: string): HttpError => new HttpError(401, "unauthorized", message);

/** The path below the group prefix, split into decoded segments; null when a segment does not decode. */
function segmentsOf(path: string, prefix: string): string[] | null {
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  try {
    return rest
      .split("/")
      .filter((s) => s !== "")
      .map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

export function amspGate(prefix: string, deps: AmspGateDeps): MiddlewareHandler<AmspEnv> {
  /**
   * The caller, against the Agent's settings: the key it presents (null when it presents none),
   * or the refusal. `notTheKeys` is the 404 a key of another Agent gets.
   */
  const authenticate = (
    header: string | undefined,
    api: AgentApiRow,
    notTheKeys: () => HttpError,
  ): string | null => {
    if (header === undefined) {
      if (!api.open) throw unauthorized("This Agent requires an API key.");
      return null;
    }
    const token = bearerToken(header);
    const key = token === null ? null : deps.agentApi.findKeyByHash(hashAgentApiKey(token));
    if (key === null) throw unauthorized("Invalid API key.");
    if (key.projectId !== api.projectId || key.agentId !== api.agentId) throw notTheKeys();
    return key.keyId;
  };

  return async (c, next) => {
    if (!deps.settings.getAgentApiEnabled()) {
      throw new HttpError(403, "agent_api_disabled", "The Agent API is turned off on this server.");
    }
    const segments = segmentsOf(c.req.path, prefix);
    const header = c.req.header("authorization");
    if (segments !== null && segments[0] === "agents" && segments.length >= 3) {
      const [, projectId, agentId] = segments as [string, string, string];
      if (!isValidId(projectId) || !isValidId(agentId)) throw agentNotFound();
      const api = deps.agentApi.get(projectId, agentId);
      if (api === null || !api.enabled) throw agentNotFound();
      if (!(await deps.agentConfig.exists(projectId, agentId))) throw agentNotFound();
      const keyId = authenticate(header, api, agentNotFound);
      c.set("amsp", { projectId, agentId, keyId, session: null });
    } else if (segments !== null && segments[0] === "sessions" && segments.length >= 2) {
      const sessionId = segments[1]!;
      if (!isValidId(sessionId)) throw sessionNotFound();
      const row = deps.sessions.findById(sessionId);
      if (row === null || row.client !== "api") throw sessionNotFound();
      const api = deps.agentApi.get(row.projectId, row.agentId);
      if (api === null || !api.enabled) throw sessionNotFound();
      const keyId = authenticate(header, api, sessionNotFound);
      c.set("amsp", { projectId: row.projectId, agentId: row.agentId, keyId, session: row });
    }
    await next();
  };
}
