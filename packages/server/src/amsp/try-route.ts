/**
 * The API tab's Try it: `POST /api/projects/:projectId/agents/:agentId/api/try` runs the Agent
 * once through the Agent API's own run handler (run-stream.ts), for the Project owner's sign-in
 * instead of a key. The body is the public route's `RunRequest`, the answer the same AMSP stream
 * or the same JSON refusals, so the tab shows exactly what a program calling the Agent receives.
 *
 * It answers only while the API would: the admin's switch off is 403 `agent_api_disabled`, the
 * Agent's switch off (or no such Agent) is 404 `agent_not_found`, as on the public routes. No key
 * is presented, so none is stamped as used. The Session a run creates is an ordinary API Session
 * of the Agent — source `api`, client `api`, the Agent's API approval mode — and nothing marks
 * who was at the keyboard.
 *
 * Owner only: the tab puts it among the owner's controls, and a run starts under the approval
 * mode the owner set for programs. A member talks to the Agent in the composer. And the owner's
 * sign-in only, like the tab's writes: the local API token is refused with 403 `human_required`
 * (requireHuman), before anything else is checked.
 */
import { Hono } from "hono";
import { requireHuman } from "../auth/middleware.js";
import type { AppEnv } from "../auth/middleware.js";
import { requireValidId } from "../http/validate.js";
import type { Access } from "../mechanisms/projects.js";
import type { AmspEnv } from "./gate.js";
import { requireAgentApiOn, requireExposedAgent } from "./gate.js";
import type { AmspRouteDeps } from "./routes.js";
import { runStream } from "./run-stream.js";

export interface AgentApiTryRouteDeps extends AmspRouteDeps {
  access: Pick<Access, "requireProjectOwner">;
}

export function agentApiTryRoutes(deps: AgentApiTryRouteDeps): Hono<AppEnv> {
  const app = new Hono<AmspEnv>();

  app.post("/", async (c) => {
    requireHuman(c);
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    // 404 for a Project the caller cannot reach, 403 `owner_required` for a member.
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    requireAgentApiOn(deps.settings);
    await requireExposedAgent(deps, projectId, agentId);
    c.set("amsp", { projectId, agentId, keyId: null, session: null });
    return runStream(c, deps);
  });

  return app as unknown as Hono<AppEnv>;
}
