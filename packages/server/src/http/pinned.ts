/**
 * Pinned-agent mode guards (PENGUIN_PINNED_AGENT; see ServerConfig.pinnedAgent).
 *
 * A pinned server serves exactly one Agent and answers 403 `agent_pinned` on every route that
 * would create, import, delete or redefine one — for everyone, the admin included. Like
 * rejectInDesktopMode, the routes stay mounted so a stray client gets a clear, localizable
 * error instead of a 404, and nothing already on disk is touched. Unlike it, the refusal is
 * per route rather than per group: every one of these files also serves reads that stay open,
 * so the check is called inline beside the existing access checks.
 *
 * These guards stop **humans** reaching the definition through the API and the Web App. They do
 * not stop the Agent's own file tools: the model is told its Agent State path and is invited to
 * edit it. The pinned Docker export's entrypoint is what closes that half, by making the
 * definition files root-owned and read-only before dropping the server to an unprivileged user.
 */
import path from "node:path";
import { agentStateDir } from "@prismshadow/penguin-core";
import { HttpError } from "./errors.js";
import type { AppDeps } from "../app.js";

function pinnedError(): HttpError {
  return new HttpError(
    403,
    "agent_pinned",
    "This server is pinned to one agent; that operation is disabled.",
  );
}

/** Refuses an operation that would create, import, delete or redefine an Agent. */
export function assertNotPinned(deps: AppDeps): void {
  if (deps.config.pinnedAgent !== null) throw pinnedError();
}

/**
 * In pinned mode, any Agent but the pinned one is 404 rather than 403: the seeded
 * `default_agent` still exists on disk, and answering 403 would advertise it.
 */
export function requirePinnedTarget(deps: AppDeps, projectId: string, agentId: string): void {
  const pinned = deps.config.pinnedAgent;
  if (pinned === null) return;
  if (projectId !== pinned.projectId || agentId !== pinned.agentId) {
    throw new HttpError(404, "agent_not_found", "Agent does not exist.");
  }
}

/**
 * Refuses a Workspace that lands inside the pinned Agent's own state directory. Without this the
 * file tools would reach the locked definition through a Workspace, which is a write path the
 * route guards above never see.
 *
 * `workspace` is already a realpath (assertWorkspaceAllowed), so a symlink cannot smuggle a path
 * past this prefix test.
 */
export function assertWorkspaceOutsidePinnedState(deps: AppDeps, workspace: string): void {
  const pinned = deps.config.pinnedAgent;
  if (pinned === null) return;
  const stateDir = agentStateDir(deps.config.root, pinned.projectId, pinned.agentId);
  const rel = path.relative(stateDir, workspace);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw pinnedError();
}
