/**
 * Session/agent API helpers shared by the server-backed commands (run / chat / ls /
 * input / logs / schedule). DTO shapes come from `@prismshadow/penguin-server/api`
 * (type-only — nothing of the server is loaded at runtime).
 */
import path from "node:path";
import type {
  AgentsResponse,
  AgentSummary,
  MessagesResponse,
  SessionCreateResponse,
  SessionInfo,
  SessionResponse,
  SessionsResponse,
} from "@prismshadow/penguin-server/api";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { resolveSessionRef, ServerClient } from "./client.js";
import { dim } from "./render.js";
import type { Messages } from "./i18n.js";

const enc = encodeURIComponent;

/**
 * `--workspace` resolution: the flag (resolved against the CLI's cwd — the server and
 * the CLI share the machine in the default flow, so a relative path means "relative to
 * where I am"), else `fallback` — the CLI's cwd historically, or the calling session's
 * Workspace when the CLI runs inside a harness agent (see callerSessionContext).
 */
export function resolveWorkspace(flag: string | undefined, fallback = process.cwd()): string {
  return flag === undefined || flag.trim() === "" ? fallback : path.resolve(flag);
}

/**
 * The calling session's live values, when this CLI runs inside a harness agent
 * (server-driven sessions inject PENGUIN_SESSION_ID into tool subprocesses): a session
 * created here defaults each UNSPECIFIED field to the caller's — workspace, the model
 * pair, approval mode and thinking level — the same inheritance `run_subagent` applies
 * to spawned children, so the two surfaces read as one convention. Per field the
 * precedence is explicit flag > caller value > the plain fallback. Null outside an
 * agent; a failed lookup warns (dim, stderr) and falls back to the plain defaults.
 */
export async function callerSessionContext(
  client: ServerClient,
  t: Messages,
): Promise<SessionInfo | null> {
  const sessionId = process.env.PENGUIN_SESSION_ID?.trim();
  if (!sessionId) return null;
  try {
    return await getSessionInfo(client, sessionId);
  } catch {
    process.stderr.write(`${dim(t.client.callerDefaultsFailed(sessionId))}\n`);
    return null;
  }
}

export interface CreateSessionArgs {
  projectId: string;
  agentId: string;
  workspace?: string;
  modelId?: string;
  provider?: string;
  approvalMode?: string;
}

/** POST .../sessions with the CLI's client hint. */
export async function createServerSession(
  client: ServerClient,
  args: CreateSessionArgs,
): Promise<SessionInfo> {
  const { projectId, agentId, ...body } = args;
  const res = await client.request<SessionCreateResponse>(
    "POST",
    `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/sessions`,
    { ...body, client: "cli" },
  );
  return res.session;
}

/** PATCHes the Session's thinking level: the pin core applies from the Session's next LLM request. */
export async function pinThinkingLevel(
  client: ServerClient,
  sessionId: string,
  level: string,
): Promise<void> {
  await client.request("PATCH", `/api/sessions/${enc(sessionId)}`, { thinkingLevel: level });
}

export async function getSessionInfo(
  client: ServerClient,
  sessionId: string,
): Promise<SessionInfo> {
  const res = await client.request<SessionResponse>("GET", `/api/sessions/${enc(sessionId)}`);
  return res.session;
}

export async function listAgents(client: ServerClient, projectId: string): Promise<AgentSummary[]> {
  const res = await client.request<AgentsResponse>("GET", `/api/projects/${enc(projectId)}/agents`);
  return res.agents;
}

export async function listAgentSessions(
  client: ServerClient,
  projectId: string,
  agentId: string,
): Promise<SessionInfo[]> {
  const res = await client.request<SessionsResponse>(
    "GET",
    `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/sessions`,
  );
  return res.sessions;
}

/**
 * The session `logs` / `input` act on: an explicit reference (full id or unique
 * fragment) resolves as everywhere else, and omitting it means the agent's most recent
 * session — the same default `chat --resume` carries, off the same newest-first listing.
 * The chosen id is announced on stderr as a dim `[latest]` line so the target is never
 * ambiguous and `--json` on stdout stays parseable.
 *
 * Returns null when the agent has no sessions at all, after printing one line pointing
 * at `penguin run` / `penguin chat` and setting a non-zero exit code.
 */
export async function resolveSessionTarget(
  client: ServerClient,
  args: { ref: string | undefined; projectId: string; agentId: string },
  t: Messages,
): Promise<string | null> {
  const { ref, projectId, agentId } = args;
  if (ref !== undefined) return await resolveSessionRef(client, projectId, ref, t);
  const latest = (await listAgentSessions(client, projectId, agentId))[0];
  if (latest === undefined) {
    process.stderr.write(`${t.error(t.client.noSessionsYet(agentId, projectId))}\n`);
    process.exitCode = 1;
    return null;
  }
  process.stderr.write(`${dim(t.client.latestSession(latest.sessionId))}\n`);
  return latest.sessionId;
}

/** GET /messages — full history messages (rendered through renderHistory). */
export async function getSessionMessages(
  client: ServerClient,
  sessionId: string,
): Promise<OmniMessage[]> {
  const res = await client.request<MessagesResponse>(
    "GET",
    `/api/sessions/${enc(sessionId)}/messages`,
  );
  // MessagesResponse messages are OmniMessages plus an optional tracePosition tag the
  // renderer ignores.
  return res.messages as unknown as OmniMessage[];
}
