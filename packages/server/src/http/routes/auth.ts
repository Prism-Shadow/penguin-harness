/**
 * Auth routes: POST /api/auth/login | logout, GET /api/auth/claim.
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 * Login issues a cookie session; logout deletes its row and clears the cookie.
 *
 * `claim` is the one password-free entry, and answers a browser with no session yet: only the
 * server can set an HttpOnly cookie, hence a GET that redirects rather than a call.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthResponse } from "../../api/types.js";
import { cookieOptions, sessionCookieName, sessionCookies } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import { HttpError } from "../errors.js";
import type { ServerConfig } from "../../config.js";
import type { Auth } from "../../mechanisms/identity.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Config, Desktop } from "../../hmr/capabilities.js";
import type { DesktopApi } from "../../hmr/capabilities.js";

export interface AuthRouteDeps {
  authService: Auth;
  config: ServerConfig;
  desktop: Pick<DesktopApi, "redeemLoginToken"> | null;
}

export function authRoutes(deps: AuthRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/login", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const password = requireString(body, "password", { label: "password" });
    const { user, token } = await deps.authService.login(userId, password);
    setCookie(
      c,
      sessionCookieName(c.req.header("host"), c.req.header("origin") !== undefined),
      token,
      cookieOptions(c, deps.authService.sessionTtlMs, deps.config.trustProxy),
    );
    return c.json({ user } satisfies AuthResponse);
  });

  app.post("/logout", (c) => {
    // Signs out every session of THIS server the request holds, under either name. The plain
    // name may carry another instance's token (one that predates per-port names): that token
    // is not ours, and its cookie is left alone.
    for (const { name, token } of sessionCookies(getCookie(c), c.req.header("host"))) {
      if (deps.authService.authenticateWithMeta(token) === null) continue;
      deps.authService.logout(token);
      deleteCookie(c, name, { path: "/" });
    }
    return c.body(null, 204);
  });

  /**
   * Two proofs, expiring differently: the desktop shell's token is spent on first use, while
   * the first-login link keeps working until a password exists — a link a mail client may
   * prefetch cannot afford to be one-shot, and until then the account protects nothing.
   * Both fail with the same redirect, so a caller learns nothing about which it got wrong.
   */
  app.get("/claim", (c) => {
    const token = c.req.query("token") ?? "";
    // Desktop first, and only it consumes on success: a first-login value handed to the
    // shell's redeemer is simply not its token, so nothing is spent looking.
    const session =
      token !== "" && deps.desktop?.redeemLoginToken(token) === true
        ? deps.authService.loginDesktop().token
        : deps.authService.redeemFirstLogin(token);
    // A browser is at the other end of this navigation, so the refusal answers a browser
    // too: an error body would leave the visitor staring at raw JSON with nothing to act
    // on. The login page takes it from here, form included. The advice it reads out of
    // `claimFailed` describes the DEPLOYMENT, never the token: a desktop shell mints a fresh
    // link on every start, so restarting the app is the way back in, while anywhere else the
    // link has to come from whoever runs the server and restarting helps nobody. Every token
    // a given server rejects yields the same value, so the refusal still says nothing about
    // which kind was presented — only that a shell is attached, which is a property of how
    // the server was started rather than of the credential.
    if (session === null)
      return c.redirect(`/login?claimFailed=${deps.desktop !== null ? "desktop" : "server"}`, 302);
    setCookie(
      c,
      // A link, so a browser followed it: a navigation carries no Origin to tell by.
      sessionCookieName(c.req.header("host"), true),
      session,
      cookieOptions(c, deps.authService.sessionTtlMs, deps.config.trustProxy),
    );
    return c.redirect("/", 302);
  });

  // The group owns its prefix: an unknown path here is not found, never a 401 from the
  // cookie gate behind it (there is no register endpoint, and a probe learns nothing).
  app.all("/*", () => {
    throw new HttpError(404, "not_found", "Not found.");
  });

  return app;
}

/**
 * Platform code: who may sign in and how is policy. The HMR layer mounts a copy of these
 * routes below its seam for a platform older than this move, which declines the prefix.
 */
@Component({
  contributes: {
    "HttpModule.routes": [{ id: "AuthRoutes.routes", prefix: "/api/auth", auth: "none", order: 5 }],
  },
})
export class AuthRoutes {
  @Use() private readonly auth!: Auth;
  @Use() private readonly config!: Config;
  @Use() private readonly desktop!: Desktop;
  @Bind("AuthRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = authRoutes({
      authService: this.auth,
      config: this.config,
      desktop: this.desktop.current(),
    });
  }
}
