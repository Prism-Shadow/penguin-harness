/**
 * The test browser's admin routes (admin only, 403 for everyone else, as the server
 * settings are): GET /api/admin/test-browser reports whether it is installed, and
 * POST /api/admin/test-browser/install starts the install — 202 with the status, or 409
 * while one is already running. The install reaches the network on the server's behalf,
 * which is why only an admin may start it and nothing starts it on its own.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import type { TestBrowser } from "./test-browser.js";
import type { TestBrowserStatusResponse } from "./test-browser-types.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "admin-api.test-browser", prefix: "/api/admin/test-browser", auth: "user", order: 45 },
    ],
  },
})
export class TestBrowserRoutes {
  @Use() private readonly browser!: TestBrowser;
  @Bind("admin-api.test-browser") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      }
      await next();
    });
    app.get("/", async (c) =>
      c.json({ browser: await this.browser.status() } satisfies TestBrowserStatusResponse),
    );
    app.post("/install", async (c) =>
      c.json({ browser: await this.browser.install() } satisfies TestBrowserStatusResponse, 202),
    );
    this.routes = app;
  }
}
