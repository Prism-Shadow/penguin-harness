/**
 * The quality checks' admin setting (admin only, 403 for everyone else, as the server
 * settings are): GET /api/admin/activity-quality reads the VPAT exceptions, and PUT replaces
 * them with `{ vpatExceptions: string[] }`. They are axe rule ids an activity meets another
 * way (audio first, for pre-readers); a quality check still reports them, but they no longer
 * fail it. Server-wide, and empty until an admin lists some.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import type { ActivityQuality } from "./quality-check.js";
import type { QualitySettingsResponse } from "./quality-types.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-quality",
        prefix: "/api/admin/activity-quality",
        auth: "user",
        order: 46,
      },
    ],
  },
})
export class QualityAdminRoutes {
  @Use() private readonly quality!: ActivityQuality;
  @Bind("admin-api.activity-quality") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      }
      await next();
    });
    app.get("/", (c) =>
      c.json({ vpatExceptions: this.quality.vpatExceptions() } satisfies QualitySettingsResponse),
    );
    app.put("/", async (c) => {
      const body = await readJson(c);
      return c.json({
        vpatExceptions: this.quality.setVpatExceptions(body.vpatExceptions as string[]),
      } satisfies QualitySettingsResponse);
    });
    this.routes = app;
  }
}
