/**
 * Provider key-minting routes:
 * POST /api/projects/:p/model-oauth/start,
 * GET  /api/projects/:p/model-oauth/callback,
 * POST /api/projects/:p/model-oauth/:flowId/code,
 * GET  /api/projects/:p/model-oauth/:flowId.
 *
 * Owner only, like every other route that spends or rewrites a Project's credentials — with
 * one deliberate exception, `GET /callback`, which is mounted ahead of the global auth
 * middleware and only deposits the code it was redirected with (see
 * `modelOAuthCallbackRoutes` below and its mount in app.ts).
 *
 * The whole exchange runs here: the PKCE verifier is generated server-side and never leaves
 * this process, and the minted key goes straight into the Project's model config without
 * passing through the browser. A caller only ever holds an opaque flow id and a status.
 */
import { Hono } from "hono";
import type {
  ModelOAuthCodeResponse,
  ModelOAuthMode,
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import { publishCredentialsUpdated } from "./models.js";

/** Flow ids are base64url (`randomBytes(32)`); reject anything else before it reaches the store. */
const FLOW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * An authorization code as it may appear in a callback query or a paste box. Bounded and
 * restricted to the characters an opaque token can hold, so nothing shaped like markup or a
 * control sequence reaches the exchange body or the page below.
 */
const CODE_RE = /^[A-Za-z0-9._~-]{1,512}$/;

/**
 * Origin the browser reached this server on, which is the origin the provider must redirect
 * back to. Taken from the request's own URL, so loopback, a LAN address and a custom port
 * all work without configuration.
 *
 * `x-forwarded-proto` / `x-forwarded-host` are caller-supplied and are honoured only when
 * the deployment says a reverse proxy sets them (PENGUIN_TRUST_PROXY=1) — the same opt-in
 * the hot-update network gate requires, and for the same reason: without it anyone who can
 * reach the bind could choose where the authorization lands.
 */
export function requestOrigin(
  url: string,
  headers: { proto?: string; host?: string },
  trustProxy: boolean,
): string {
  const own = new URL(url);
  if (!trustProxy) return own.origin;
  // A chain of proxies appends to these headers; the client-facing hop is the first value.
  const proto = headers.proto?.split(",")[0]?.trim();
  const host = headers.host?.split(",")[0]?.trim();
  const scheme = proto === "http" || proto === "https" ? proto : own.protocol.replace(":", "");
  return `${scheme}://${host !== undefined && host !== "" ? host : own.host}`;
}

/** Validates the optional `mode` field of a start request. */
function parseMode(value: unknown): ModelOAuthMode {
  if (value === undefined) return "callback";
  if (value !== "callback" && value !== "manual") {
    throw badRequest('mode must be "callback" or "manual".');
  }
  return value;
}

/**
 * The page the provider's redirect lands on. Rendered by the browser in a tab of its own, so
 * it carries its own styling and loads nothing: no script, no font, no image. It reports the
 * outcome and nothing else — never the code, never the key, never anything about the Project.
 */
function resultPage(title: string, body: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f9fafb; color: #111827;
}
main { max-width: 30rem; padding: 2rem; text-align: center; }
h1 { margin: 0 0 0.5rem; font-size: 1.125rem; font-weight: 600; }
p { margin: 0; color: #4b5563; }
@media (prefers-color-scheme: dark) {
  body { background: #0d0d0d; color: #f3f4f6; }
  p { color: #9ca3af; }
}
</style>
</head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body>
</html>
`;
}

/** Credential change: same follow-up the models PUT performs, so live Sessions pick the key up. */
function credentialsChanged(deps: AppDeps, projectId: string): void {
  deps.manager.invalidateProjectRuntimes(projectId);
  publishCredentialsUpdated(deps, projectId);
}

/**
 * `GET /api/projects/:projectId/model-oauth/callback` — where the provider sends the browser
 * back, and the ONE route of this group that does not require a session.
 *
 * It cannot require one. A loopback OAuth redirect receiver is reached by whichever browser
 * the provider redirected, which is not necessarily the one that started the flow: the
 * desktop shell hands every non-app URL to `shell.openExternal`, so the authorization page
 * opens in the *system* browser, and the system browser holds no `penguin_session` cookie
 * for `http://localhost:<port>`. Behind the global auth middleware every desktop
 * authorization therefore ended on a bare 401 while the same flow completed in the browser,
 * where the popup is a tab of the session that opened it.
 *
 * What it does without a session is deliberately less than finishing the flow: it deposits
 * the code on the flow and says so. The exchange that redeems that code and writes the key
 * runs on the owner's next poll of `GET /:flowId`, which is behind the gate — so this route
 * has no authority of its own to write a credential into a Project. A caller who learned a
 * flow id can put a code in front of that poll — but only by beating the provider's own
 * redirect to the flow's single deposit slot, and what they deposit stays inert unless the
 * owner's own session goes on to poll that flow.
 *
 * The flow id it authorizes on is a capability rather than a name: 32 random bytes minted
 * server-side, bound in ModelOAuthService to a user, a Project, a provider and a PKCE
 * verifier that never leaves this process, valid for ten minutes and depositable once. The
 * Project in the path must be the flow's own, so a flow id cannot be redirected at a Project
 * it does not belong to, and a flow opened in manual mode is refused outright — it was
 * handed no callback URL, so it has no redirect to receive.
 *
 * Mounted separately (not inside `modelOAuthRoutes`) because the exemption has to be exactly
 * this literal path: it is registered ahead of the auth middleware in app.ts, where a
 * whole-group mount would have exempted /start, /:flowId/code and the status route with it.
 * Those stay owner-only, unchanged. Only GET is served — the handler refuses the HEAD that
 * Hono re-dispatches into it rather than let a safe method spend the deposit.
 *
 * Answers HTML throughout — a person is looking at this tab, not a client parsing JSON.
 */
export function modelOAuthCallbackRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    // Hono re-dispatches a HEAD as a GET before routing and returns the result bodiless, so
    // without this a HEAD would run the handler below and spend the flow's one deposit. The
    // re-dispatch carries the original Request, so the method still reads as HEAD here.
    if (c.req.method === "HEAD") return c.body(null, 405);
    const projectId = requireValidId(c, "projectId");
    const flowId = c.req.query("flow") ?? "";
    // The provider appends `code=` to the callback URL it was given, preserving its path and
    // query, which is how the flow id rides back alongside it.
    const code = c.req.query("code") ?? "";
    if (!FLOW_ID_RE.test(flowId) || !CODE_RE.test(code)) {
      return c.html(
        resultPage(
          "Authorization failed",
          "This link is incomplete. Return to PenguinHarness and start a new authorization.",
        ),
        400,
      );
    }
    try {
      // The flow id is the credential here; there is no session to read a user from — and
      // depositing is all this route may do with it.
      deps.modelOAuth.deposit({ flowId, projectId, code });
    } catch (err) {
      const message =
        err instanceof HttpError
          ? err.message
          : "Something went wrong. Return to PenguinHarness and start a new authorization.";
      // A refusal is a page, not an API error: every one of them answers 400, and the
      // service's own sentence is what tells the person what to do about it.
      return c.html(resultPage("Authorization failed", message), 400);
    }
    return c.html(
      resultPage(
        "Authorization received",
        "Return to PenguinHarness — it finishes the authorization and reports the outcome there. You can close this tab.",
      ),
    );
  });

  return app;
}

export function modelOAuthRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Opens a flow and returns the page to send the user to. The provider is looked up in the
  // built-in catalog inside the service, which is what rejects a group that publishes no
  // such flow and what keeps the authorize/exchange endpoints out of client control.
  app.post("/start", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const provider = requireString(body, "provider", { minLen: 1, maxLen: 64 });
    const mode = parseMode(body.mode);
    const started = deps.modelOAuth.start({
      projectId,
      userId: c.var.user.userId,
      provider,
      mode,
      callbackOrigin: requestOrigin(
        c.req.url,
        {
          ...(c.req.header("x-forwarded-proto") !== undefined
            ? { proto: c.req.header("x-forwarded-proto")! }
            : {}),
          ...(c.req.header("x-forwarded-host") !== undefined
            ? { host: c.req.header("x-forwarded-host")! }
            : {}),
        },
        deps.config.trustProxy,
      ),
    });
    return c.json(started satisfies ModelOAuthStartResponse);
  });

  // Manual counterpart of the callback: the user pastes the one-time code the authorization
  // page displayed when it was asked not to redirect. Owner-only, because unlike the
  // callback this one IS reached by the App's own signed-in tab.
  app.post("/:flowId/code", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const flowId = c.req.param("flowId") ?? "";
    if (!FLOW_ID_RE.test(flowId)) {
      throw new HttpError(
        404,
        "model_oauth_flow_not_found",
        "This authorization has expired or does not exist. Start a new one.",
      );
    }
    const body = await readJson(c);
    const code = requireString(body, "code", { minLen: 1, maxLen: 512 }).trim();
    if (!CODE_RE.test(code)) throw badRequest("code is not a valid authorization code.");
    const result = await deps.modelOAuth.complete({
      flowId,
      userId: c.var.user.userId,
      projectId,
      code,
    });
    if (!result.ok) {
      return c.json({ ok: false, error: result.error } satisfies ModelOAuthCodeResponse);
    }
    credentialsChanged(deps, projectId);
    return c.json({ ok: true, applied: result.applied } satisfies ModelOAuthCodeResponse);
  });

  // Poll target while the user is authorizing in the other tab, and where a redirect flow's
  // exchange actually runs: the receiver only deposits the code, so the key is minted and
  // written under the owner's own session (see the service's `deposit` and `poll`).
  app.get("/:flowId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    const flowId = c.req.param("flowId") ?? "";
    if (!FLOW_ID_RE.test(flowId)) {
      throw new HttpError(
        404,
        "model_oauth_flow_not_found",
        "This authorization has expired or does not exist. Start a new one.",
      );
    }
    const state = await deps.modelOAuth.poll({ flowId, userId: c.var.user.userId, projectId });
    // Set only on the poll that redeemed, so the follow-up fires once, exactly as it does on
    // the pasted-code route.
    if (state.applied !== undefined) credentialsChanged(deps, projectId);
    return c.json({
      status: state.status,
      provider: state.provider,
      ...(state.applied !== undefined ? { applied: state.applied } : {}),
      ...(state.error !== undefined ? { error: state.error } : {}),
    } satisfies ModelOAuthStatusResponse);
  });

  return app;
}
