/**
 * /api/hmr/*: the hot-update surface, declared and contributed like every other route group.
 *
 * What a push IS — its body, the outcome it answers with, what happens when the pushed
 * generation cannot become current — is the mechanism's, in packages/hmr's main.ts
 * (`upgradeEndpoint`). What is here is the product's: the network gate, who may push, and
 * what clients are told when a version lands. The cookie / API-token gate is the platform's
 * usual middleware, applied after the network gate; admin is checked on top.
 *
 * Because the group is the platform's, a generation that does not serve it would leave
 * the installation with no way to push another — so a push is refused before commit when
 * its generation does not answer here (`admitsUpgradeRoute`).
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { authMiddleware } from "../auth/middleware.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Auth } from "../mechanisms/identity.js";
import { HttpError } from "../http/errors.js";
import { Channels, Config, HmrControl } from "./capabilities.js";
import type { ServerConfig } from "../config.js";
import type { ChannelHub } from "../runtime/channel.js";
import type { HmrControlApi } from "./capabilities.js";

/** Bind addresses considered safe by default; anything else needs HTTPS. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface HmrRouteDeps {
  control: HmrControlApi;
  /** The platform's auth, applied here after the network gate rather than by the group's `auth: "user"`, so a plaintext public bind is refused before any credential is looked at. */
  auth: Auth;
  config: Pick<ServerConfig, "host" | "trustProxy">;
  channels: Pick<ChannelHub, "broadcast">;
}

export function hmrRoutes(deps: HmrRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use("*", async (c, next) => {
    // Dangerous-network off: hot APIs load and run code, so on a non-loopback
    // bind (e.g. 0.0.0.0) without HTTPS they answer 403. There is no override
    // via the request itself — see the header note below.
    if (!LOOPBACK_HOSTS.has(deps.config.host.toLowerCase())) {
      // `x-forwarded-proto` is caller-supplied and UNTRUSTED by default: anyone who can
      // reach this bind at all can set it to `https` and walk straight through this gate
      // while actually speaking plaintext HTTP (the gate exists precisely for the case
      // where the caller is not a trusted party). Only a request's own URL scheme (real
      // TLS terminated by this process) counts unless the deployment explicitly says a
      // reverse proxy is in front and strips/overwrites the header itself
      // (PENGUIN_TRUST_PROXY=1 / config.trustProxy) — the same opt-in a real proxy setup
      // requires anyway.
      const proto = deps.config.trustProxy
        ? (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", ""))
        : new URL(c.req.url).protocol.replace(":", "");
      if (proto !== "https") {
        throw new HttpError(
          403,
          "hmr_disabled",
          "Hot platform APIs are disabled on a non-loopback bind without HTTPS. " +
            "Serve over HTTPS to enable them.",
        );
      }
    }
    await next();
  });
  // Then the platform's cookie / API-token gate, and admin on top.
  routes.use("*", authMiddleware(deps.auth, deps.config.trustProxy));
  routes.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "forbidden", "Hot platform APIs are admin-only.");
    }
    await next();
  });

  // What the store lacks of these blobs, so the push that follows carries only those. A
  // pusher that gets a 404 here is talking to a generation older than the probe and sends
  // everything inline, as it always did. The answer is the mechanism's, like the push's.
  routes.post("/assets/probe", (c) => deps.control.endpoint(c.req.raw));

  // THE ONE upgrade endpoint: platform + cli + web move together, atomically — there is no
  // route that updates any of the three alone. The body and the answer are the mechanism's
  // (packages/hmr); live clients (browser tabs AND the desktop window) are told to reload
  // once a version actually lands.
  routes.post("/upgrade", (c) =>
    deps.control.endpoint(c.req.raw, (outcome) =>
      deps.channels.broadcast(
        "user:",
        { type: "web_updated", rev: outcome.web.rev },
        "server_event",
      ),
    ),
  );

  return routes;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      // Manifest data is literal (gen-ifaces reads it off the source): the same prefix packages/hmr exports as HMR_ROUTE_PREFIX.
      // `auth: "none"` only in the manifest: the group gates itself, network first, then the
      // platform's own auth middleware — the order the gate's tests pin.
      { id: "HmrRoutes.routes", prefix: "/api/hmr", auth: "none", order: 5 },
    ],
  },
})
export class HmrRoutes {
  @Use() private readonly control!: HmrControl;
  @Use() private readonly auth!: Auth;
  @Use() private readonly config!: Config;
  @Use() private readonly channels!: Channels;
  @Bind("HmrRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = hmrRoutes({
      // The node's contract keeps the instance and the outcome opaque; the routes speak the real types.
      control: this.control as unknown as HmrControlApi,
      auth: this.auth,
      config: this.config,
      channels: this.channels,
    });
  }
}
