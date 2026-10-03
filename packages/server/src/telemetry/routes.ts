/**
 * The telemetry read surface (PRFC-0008 "看哪" / "权限"), admin only:
 *
 *   GET    /api/telemetry?view=probes|sessions|samples[&probe=][&session=][&limit=]
 *   DELETE /api/telemetry    — empties the buffer
 *
 * Admin only for the reason unattributed errors are: the samples carry other users' Session
 * ids and routes, so a member's view would leak across tenants. The switch itself is a system
 * setting (`PUT /api/admin/settings { telemetry }`), not a route of its own.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { TelemetryQuery, TelemetryResponse } from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import type { Telemetry } from "../mechanisms/telemetry.js";
import { summarizeProbes, summarizeSessions } from "./buffer.js";

const VIEWS = ["probes", "sessions", "samples"] as const;
type View = (typeof VIEWS)[number];

export function telemetryRoutes(telemetry: Telemetry): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can read telemetry.");
    }
    await next();
  });

  app.get("/", (c) => {
    const view = (c.req.query("view") ?? "probes") as View;
    if (!VIEWS.includes(view)) {
      throw new HttpError(400, "bad_request", `view must be one of ${VIEWS.join(", ")}.`);
    }
    const query: TelemetryQuery = {};
    const probe = c.req.query("probe");
    const session = c.req.query("session");
    if (probe !== undefined && probe !== "") query.probe = probe;
    if (session !== undefined && session !== "") query.session = session;
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined) {
      const limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new HttpError(400, "bad_request", "limit must be a positive integer.");
      }
      query.limit = limit;
    }
    const enabled = telemetry.on();
    // The current state (process and Session 内存) joins the buffer as of this read.
    telemetry.snapshot();
    const buffered = enabled ? telemetry.samples({}).length : 0;
    const body: TelemetryResponse = { enabled, view, buffered };
    if (view === "samples") {
      body.samples = telemetry.samples(query);
    } else {
      // The summaries are over every match; `limit` narrows only the raw listing.
      const { limit: _limit, ...unlimited } = query;
      const matched = telemetry.samples(unlimited);
      if (view === "probes") body.probes = summarizeProbes(matched);
      else body.sessions = summarizeSessions(matched);
    }
    return c.json(body);
  });

  app.delete("/", (c) => {
    telemetry.clear();
    return c.json({ ok: true });
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "TelemetryRoutes.routes",
        prefix: "/api/telemetry",
        auth: "user",
        order: 46,
      },
    ],
  },
})
export class TelemetryRoutes {
  @Use() private readonly telemetry!: Telemetry;
  @Bind("TelemetryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = telemetryRoutes(this.telemetry);
  }
}
