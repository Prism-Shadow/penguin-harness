/** System-wide approval mode: one value shared by all users, Projects, Agents, and Sessions. */
import { Hono } from "hono";
import type { ApprovalMode, ApprovalModeResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { readJson, requireEnum } from "../validate.js";

const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];

export function approvalModeRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({ approvalMode: deps.approvalModes.get() } satisfies ApprovalModeResponse),
  );

  app.put("/", async (c) => {
    const body = await readJson(c);
    const approvalMode = requireEnum(body, "approvalMode", APPROVAL_MODES);
    deps.approvalModes.set(approvalMode);
    return c.json({ approvalMode } satisfies ApprovalModeResponse);
  });

  return app;
}
