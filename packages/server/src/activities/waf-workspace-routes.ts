/**
 * The WAF workspace's admin routes (admin only, 403 for everyone else): GET
 * /api/admin/waf-workspace reads its state, POST .../prepare starts cloning what is missing,
 * GET and PUT .../settings read and change the remotes, branches and any existing checkout.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import type { WafWorkspace } from "./waf-workspace.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.waf-workspace",
        prefix: "/api/admin/waf-workspace",
        auth: "user",
        order: 49,
      },
    ],
  },
})
export class WafWorkspaceAdminRoutes {
  @Use() private readonly workspace!: WafWorkspace;
  @Bind("admin-api.waf-workspace") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      }
      await next();
    });
    app.get("/", async (c) => c.json({ status: await this.workspace.status() }));
    app.post("/prepare", async (c) => c.json({ status: await this.workspace.prepare() }));
    app.get("/settings", (c) => c.json({ settings: this.workspace.settings() }));
    app.put("/settings", async (c) =>
      c.json({ settings: this.workspace.saveSettings(await readJson(c)) }),
    );
    this.routes = app;
  }
}
