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
import fs from "node:fs/promises";
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
 * Both sides are resolved before they are compared, and that is the whole of the check being
 * correct: `resolvedWorkspace` arrives from `assertWorkspaceAllowed` as a realpath, while the
 * data root is whatever PENGUIN_HOME spells — a symlinked path on macOS (`/var` -> `/private/var`),
 * an 8.3 short name on Windows, a bind mount reached through a link anywhere. Two spellings of the
 * one directory look like a traversal to `path.relative`, and the Workspace is then waved through.
 *
 * The state directory exists by the time this runs: the caller has already established that the
 * target is the pinned Agent and that its `system_config.yaml` is there.
 */
export async function assertWorkspaceOutsidePinnedState(
  deps: AppDeps,
  resolvedWorkspace: string,
): Promise<void> {
  const pinned = deps.config.pinnedAgent;
  if (pinned === null) return;
  const stateDir = await fs.realpath(
    agentStateDir(deps.config.root, pinned.projectId, pinned.agentId),
  );
  const rel = path.relative(stateDir, resolvedWorkspace);
  // A `..` **segment** means outside; `rel.startsWith("..")` would also match a real child named
  // `..foo`, which is inside and must be refused. An adjacent sibling (`agent_state_backup`) comes
  // back as `../agent_state_backup` and is correctly outside.
  const outside = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (!outside) throw pinnedError();
}
