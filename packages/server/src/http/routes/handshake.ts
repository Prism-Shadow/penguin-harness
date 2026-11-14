/**
 * The runtime handshake's route: `GET /api/handshake` answers the build this process loaded when
 * it STARTED. Read-only, behind the same door as the version question it sits beside.
 *
 * The difference from `GET /api/version` is the moment the answer was taken at, not its shape.
 * That door reads the pushed state off the data root every time it is asked, so a hot update
 * moves it; this one is the report taken at this process's first boot and kept in the runtime's
 * cross-generation resource registry — the platform is what a hot update replaces, the process
 * and that registry are not — so no push can move it. A server older than this route answers
 * 404 there, which its hub reads as "identity unknown", never as a failure of the machine.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import { Hmr, Paths } from "../../hmr/capabilities.js";
import { versionReport } from "../../version-report.js";
import type { HandshakeAnswer } from "../../machines/handshake.js";

/** The registry slot this process's boot identity lives in (see bootIdentity). */
const BOOT_IDENTITY = "handshake:boot-identity";

/**
 * The identity this process loaded at its start, taken once and kept in the hot-update host's
 * resource registry (packages/hmr's HotResources), which outlives every platform generation: a
 * generation a hot update swapped in reads that record back, so the answer stays the PROCESS's.
 */
export function bootIdentity(resources: Resources, root: string): Promise<HandshakeAnswer> {
  const recorded = resources.claim<Promise<HandshakeAnswer>>(BOOT_IDENTITY);
  if (recorded !== undefined) return recorded;
  const taken = versionReport(root).then((identity) => ({ identity }));
  resources.register(BOOT_IDENTITY, taken);
  return taken;
}

/** The route group's own app. `identity` is the promise bootIdentity answered. */
export function handshakeRoutes(deps: { identity: () => Promise<HandshakeAnswer> }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", async (c) => c.json((await deps.identity()) satisfies HandshakeAnswer));
  return app;
}

/**
 * The route group as a module component: mounted by the platform's ApiModule beside the version
 * routes it shares a door with (`src/platform.ts`), at `/api/handshake`.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "HandshakeRoutes.routes", prefix: "/api/handshake", auth: "user", order: 21 },
    ],
  },
})
export class HandshakeRoutes {
  @Use() private readonly paths!: Paths;
  @Use() private readonly hmr!: Hmr;
  @Bind("HandshakeRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const identity = bootIdentity(this.hmr.resources, this.paths.root);
    this.routes = handshakeRoutes({ identity: () => identity });
  }
}
