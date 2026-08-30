/**
 * Member authorization routes:
 * GET|POST /api/projects/:p/members, DELETE /api/projects/:p/members/:userId.
 * Reading requires access; adding/removing is owner-only (validated inside the service).
 * Desktop mode rejects the whole surface (single-user; 403 `desktop_single_user`).
 */
import { Hono } from "hono";
import type { MemberAddResponse, MembersResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { rejectInDesktopMode } from "./desktop.js";
import type { DesktopService } from "../../services/desktop-service.js";
import { pathParam, readJson, requireString, requireValidId } from "../validate.js";
import type { ProjectLifecycle } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MembersRouteDeps {
  desktop: DesktopService | null;
  projectService: ProjectLifecycle;
}

export function membersRoutes(deps: MembersRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", rejectInDesktopMode(deps));

  app.get("/", (c) => {
    // Defensive id validation.
    const members = deps.projectService.listMembers(
      c.var.user.userId,
      requireValidId(c, "projectId"),
    );
    return c.json({ members } satisfies MembersResponse);
  });

  app.post("/", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const member = deps.projectService.addMember(
      c.var.user.userId,
      requireValidId(c, "projectId"),
      userId,
    );
    return c.json({ member } satisfies MemberAddResponse, 201);
  });

  app.delete("/:userId", (c) => {
    deps.projectService.removeMember(
      c.var.user.userId,
      requireValidId(c, "projectId"),
      pathParam(c, "userId"),
    );
    return c.body(null, 204);
  });

  return app;
}
