/**
 * The deploy settings' admin routes (admin only, 403 for everyone else, as the server
 * settings are): GET /api/admin/activity-deploy/settings reads them with the tokens masked,
 * PUT replaces the fields it names (a token left empty keeps the stored one, null clears
 * it), and POST .../settings/test/:target makes one read-only GET to that Jenkins with the
 * stored credentials and says only whether it answered with success.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import type { ActivityDeploys } from "./deploy-service.js";
import type {
  DeployConnectionTestResponse,
  DeploySettingsResponse,
  DeployTarget,
} from "./deploy-types.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-deploy",
        prefix: "/api/admin/activity-deploy",
        auth: "user",
        order: 48,
      },
    ],
  },
})
export class DeployAdminRoutes {
  @Use() private readonly deploys!: ActivityDeploys;
  @Bind("admin-api.activity-deploy") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      }
      await next();
    });
    app.get("/settings", (c) =>
      c.json({ settings: this.deploys.settings() } satisfies DeploySettingsResponse),
    );
    app.put("/settings", async (c) => {
      const body = await readJson(c);
      return c.json({
        settings: this.deploys.saveSettings(body),
      } satisfies DeploySettingsResponse);
    });
    app.post("/settings/test/:target", async (c) => {
      const target = c.req.param("target");
      if (target !== "qa" && target !== "prod")
        throw new HttpError(404, "deploy_target_not_found", "The target must be qa or prod.");
      return c.json({
        test: await this.deploys.testConnection(target satisfies DeployTarget),
      } satisfies DeployConnectionTestResponse);
    });
    this.routes = app;
  }
}
