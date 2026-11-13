/**
 * Whether goal mode can start on an Agent at all: the goal plugin's hook package is on disk
 * (`agent_state/hooks/goal/hooks.json`). `SessionManager.startGoal` asks this BEFORE it loads
 * the Session, so a goal refused for a missing plugin builds no core Session and leaves no
 * runtime entry behind for a conversation whose first Task is about to be refused. The loaded
 * Session's own answer stays the backstop: a package that declares no host-triggered
 * `user_prompt` command is on disk and still cannot start a goal.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { hooksDir } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { GOAL_HOOK_NAME } from "./goal-events.js";

export async function hasGoalHookPackage(
  root: string,
  projectId: string,
  agentId: string,
): Promise<boolean> {
  try {
    await fs.access(path.join(hooksDir(root, projectId, agentId), GOAL_HOOK_NAME, "hooks.json"));
    return true;
  } catch {
    return false;
  }
}

/** The refusal both checks answer with — the 409 the Web's plugin notice stands in front of. */
export function goalPluginNotInstalled(): HttpError {
  return new HttpError(
    409,
    "goal_plugin_not_installed",
    "Goal mode needs the goal plugin installed on this agent.",
  );
}
