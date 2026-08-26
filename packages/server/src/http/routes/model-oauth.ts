/**
 * Provider key-minting routes:
 * POST /api/projects/:p/model-oauth/start,
 * GET  /api/projects/:p/model-oauth/callback,
 * POST /api/projects/:p/model-oauth/:flowId/code,
 * GET  /api/projects/:p/model-oauth/:flowId.
 *
 * Owner only, like every other route that spends or rewrites a Project's credentials. The
 * whole exchange runs here: the PKCE verifier is generated server-side and never leaves this
 * process, and the minted key goes straight into the Project's model config without passing
 * through the browser. A caller only ever holds an opaque flow id and a status.
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

/** One sentence per failure reason, phrased for the redirect page (the Web App localizes its own). */
const FAILURE_TEXT: Record<string, string> = {
  invalid_request:
    "TokenDance rejected the authorization request. Start a new one in PenguinHarness.",
  code_rejected:
    "The authorization is no longer valid — it may have expired or already been used. Start a new one in PenguinHarness.",
  upstream_failed: "The provider did not return a usable key. Start a new one in PenguinHarness.",
  unreachable:
    "The provider could not be reached. Check the network and start a new one in PenguinHarness.",
  apply_failed:
    "A key was created but could not be saved. Authorize again, then delete the unused key in the provider's console.",
};

export function modelOAuthRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Credential change: same follow-up the models PUT performs, so live Sessions pick the key up. */
  const credentialsChanged = (projectId: string): void => {
    deps.manager.invalidateProjectRuntimes(projectId);
    publishCredentialsUpdated(deps, projectId);
  };

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

  // Where the provider sends the browser back. Registered before the `:flowId` status route
  // so the literal path wins. Answers HTML throughout — a person is looking at this tab, not
  // a client parsing JSON.
  app.get("/callback", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
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
    let result: Awaited<ReturnType<typeof deps.modelOAuth.complete>>;
    try {
      result = await deps.modelOAuth.complete({
        flowId,
        userId: c.var.user.userId,
        projectId,
        code,
      });
    } catch (err) {
      const message =
        err instanceof HttpError
          ? err.message
          : "Something went wrong. Return to PenguinHarness and start a new authorization.";
      return c.html(resultPage("Authorization failed", message), 400);
    }
    if (!result.ok) {
      return c.html(resultPage("Authorization failed", FAILURE_TEXT[result.error]!), 400);
    }
    credentialsChanged(projectId);
    return c.html(
      resultPage(
        "API key created",
        "The new key has been saved to this Project's models. You can close this tab and return to PenguinHarness.",
      ),
    );
  });

  // Manual counterpart of the callback: the user pastes the one-time code the authorization
  // page displayed when it was asked not to redirect.
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
    credentialsChanged(projectId);
    return c.json({ ok: true, applied: result.applied } satisfies ModelOAuthCodeResponse);
  });

  // Poll target while the user is authorizing in the other tab.
  app.get("/:flowId", (c) => {
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
    const state = deps.modelOAuth.status({ flowId, userId: c.var.user.userId, projectId });
    return c.json(state satisfies ModelOAuthStatusResponse);
  });

  return app;
}
