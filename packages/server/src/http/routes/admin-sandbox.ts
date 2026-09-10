/**
 * Sandbox settings (admin only):
 *
 *   GET /api/admin/sandbox  the active settings, the backends this deployment has, and which
 *                           isolation dimensions they cover
 *   PUT /api/admin/sandbox  replace the settings; applies to the next command spawn
 *
 * Confinement is enforced by a BACKEND — a plugin contributing to `SandboxModule.providers`
 * (bwrap on Linux, Seatbelt on macOS, MXC on Windows, DSH anywhere). With none mounted, a
 * confining mode has nothing to enforce it, so the response reports the backends and the page
 * says so rather than implying protection that is not there.
 *
 * The settings are stored in server_settings (sandbox/settings-store.ts), so they survive a
 * restart as well as a hot push.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { SandboxSettingsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson } from "../validate.js";
import { Sandbox } from "../../sandbox/service.js";
import {
  parseSandboxSettings,
  SandboxConfig,
  SandboxSettingsError,
} from "../../sandbox/settings-store.js";

export interface AdminSandboxDeps {
  sandbox: Sandbox;
  config: SandboxConfig;
}

export function adminSandboxRoutes(deps: AdminSandboxDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  const view = (): SandboxSettingsResponse => ({
    settings: deps.sandbox.currentSettings(),
    backends: deps.sandbox.backends().map((b) => ({ name: b.name, dimensions: [...b.dimensions] })),
  });

  app.get("/", async (c) => {
    // Backends load asynchronously (dynamic imports, probes): a page opened during the first
    // seconds of a boot would otherwise report an empty list and read as "none installed".
    await deps.sandbox.whenReady();
    return c.json(view());
  });

  app.put("/", async (c) => {
    let settings;
    try {
      settings = parseSandboxSettings(await readJson(c));
    } catch (err) {
      if (err instanceof SandboxSettingsError) throw badRequest(err.message);
      throw err;
    }
    await deps.sandbox.whenReady();
    deps.config.save(settings);
    return c.json(view());
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "AdminSandboxRoutes.routes",
        prefix: "/api/admin/sandbox",
        auth: "user",
        order: 20,
      },
    ],
  },
})
export class AdminSandboxRoutes {
  @Use() private readonly sandbox!: Sandbox;
  @Use() private readonly sandboxConfig!: SandboxConfig;
  @Bind("AdminSandboxRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = adminSandboxRoutes({ sandbox: this.sandbox, config: this.sandboxConfig });
  }
}
