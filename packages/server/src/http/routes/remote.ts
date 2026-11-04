import { Hono } from "hono";
import { bearerToken, SESSION_COOKIE } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Auth } from "../../mechanisms/identity.js";
import { HttpError } from "../errors.js";
import { readJson } from "../validate.js";
import { mediaType } from "../media-type.js";

export interface RemoteSessionResponse {
  cookieName: typeof SESSION_COOKIE;
  sessionToken: string;
  expiresAt: string;
  maxAgeSeconds: number;
}

export function remoteRoutes(deps: { authService: Auth }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/session", async (c) => {
    if (c.var.sessionVia !== "token" || bearerToken(c.req.header("authorization")) === null) {
      throw new HttpError(
        403,
        "local_api_token_required",
        "Only the local API token may issue a remote browser session.",
      );
    }
    if (mediaType(c.req.header("content-type"))?.essence !== "application/json") {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Remote session exchange requires application/json.",
      );
    }
    await readJson(c);
    const session = deps.authService.issueRemoteSession();
    c.header("cache-control", "no-store");
    return c.json({
      cookieName: SESSION_COOKIE,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      maxAgeSeconds: session.maxAgeSeconds,
    } satisfies RemoteSessionResponse);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "RemoteRoutes.routes", prefix: "/api/remote", auth: "token", order: 55 },
    ],
  },
})
export class RemoteRoutes {
  @Use() private readonly auth!: Auth;
  @Bind("RemoteRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = remoteRoutes({ authService: this.auth });
  }
}
