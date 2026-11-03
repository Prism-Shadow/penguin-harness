/**
 * The one session-API helper the server's own commands need (`org` resolves a session's
 * agent through it): a single request, no session-module state. The CLI's session module
 * keeps its richer task-side helpers in the CLI package and re-exports this one, so its
 * callers do not change.
 */
import type { SessionInfo, SessionResponse } from "../api/types.js";
import type { ServerClient } from "./client.js";

const enc = encodeURIComponent;

/** The info one session carries: whose it is, which agent runs it, its title and model. */
export async function getSessionInfo(
  client: ServerClient,
  sessionId: string,
): Promise<SessionInfo> {
  const res = await client.request<SessionResponse>("GET", `/api/sessions/${enc(sessionId)}`);
  return res.session;
}
