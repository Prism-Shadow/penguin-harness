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
 * The settings park with the platform, so they survive a hot push; nothing here writes to the
 * server_settings table.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SandboxMode, SandboxSettings } from "@prismshadow/penguin-core/plugin";
import type { AppEnv } from "../../auth/middleware.js";
import type { SandboxSettingsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { readJson } from "../validate.js";
import { Sandbox } from "../../sandbox/service.js";

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
/** Cap on the mask list: a policy, not a filesystem index. */
const MAX_MASK_PATHS = 64;

export interface AdminSandboxDeps {
  sandbox: Sandbox;
}

/** Parses a settings body, rejecting the whole request rather than storing half of it. */
export function parseSandboxSettings(body: Record<string, unknown>): SandboxSettings {
  const mode = body.mode;
  if (typeof mode !== "string" || !MODES.includes(mode as SandboxMode)) {
    throw new HttpError(400, "bad_request", `mode must be one of ${MODES.join(", ")}.`);
  }
  const network = body.network;
  if (network !== undefined && network !== null && network !== "none") {
    throw new HttpError(400, "bad_request", 'network must be "none" or null.');
  }
  const rawPaths = body.maskPaths;
  let maskPaths: string[] | undefined;
  if (rawPaths !== undefined && rawPaths !== null) {
    if (!Array.isArray(rawPaths) || rawPaths.some((p) => typeof p !== "string")) {
      throw new HttpError(400, "bad_request", "maskPaths must be an array of paths.");
    }
    const cleaned = [
      ...new Set((rawPaths as string[]).map((p) => p.trim()).filter((p) => p !== "")),
    ];
    if (cleaned.length > MAX_MASK_PATHS) {
      throw new HttpError(
        400,
        "bad_request",
        `maskPaths may name at most ${MAX_MASK_PATHS} paths.`,
      );
    }
    if (cleaned.length > 0) maskPaths = cleaned;
  }
  return {
    mode: mode as SandboxMode,
    ...(network === "none" ? { network: "none" as const } : {}),
    ...(maskPaths === undefined ? {} : { maskPaths }),
  };
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
    const settings = parseSandboxSettings(await readJson(c));
    await deps.sandbox.whenReady();
    deps.sandbox.configure(settings);
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
  @Bind("AdminSandboxRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = adminSandboxRoutes({ sandbox: this.sandbox });
  }
}
