/**
 * Feishu (Lark) binding routes: /api/sessions/:sessionId/feishu[...].
 *
 * Authorization mirrors the vault's split, through the sessions routes' resolveSession
 * pattern (404 never leaks a Session's existence): any Project member can read the binding
 * (secret masked) and run the two tests; the secret-mutating writes — PUT and DELETE — are
 * Project-owner-only.
 *
 * Round-trip rule for the secret: GET only ever returns the masked value, and a PUT whose
 * `appSecret` is omitted or blank keeps the stored one (the same never-round-trip-masked-
 * keys convention as the models test endpoint), so the plaintext exists only at first entry.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  FeishuBindingInfo,
  FeishuBindingResponse,
  FeishuTestMessageResponse,
  FeishuTestResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { FeishuBindingRow } from "../../db/repos/feishu-bindings.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import { maskApiKey } from "../../services/project-config-service.js";
import { HttpError } from "../errors.js";
import { badRequest, optionalString, readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

/** Default Feishu open-platform domain (Lark tenants override it in the form). */
export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

function toBindingInfo(row: FeishuBindingRow): FeishuBindingInfo {
  return {
    sessionId: row.sessionId,
    appId: row.appId,
    appSecretMasked: maskApiKey(row.appSecret),
    baseDomain: row.baseDomain,
    enabled: row.enabled,
    lastChatKnown: row.lastChatId !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Normalizes a domain input: blank → the default; anything else must be an http(s) origin. */
function parseBaseDomain(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return FEISHU_DEFAULT_DOMAIN;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw badRequest("baseDomain must be an http(s) URL, e.g. https://open.feishu.cn.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("baseDomain must be an http(s) URL, e.g. https://open.feishu.cn.");
  }
  // The SDK joins paths onto the domain itself: keep only the origin.
  return url.origin;
}

export function feishuRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Same lookup-and-authz shape as the sessions routes: 404 without leaking existence. */
  const resolveSession = (c: Context<AppEnv>): SessionRow => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId ? deps.sessionsRepo.findById(sessionId) : null;
    if (!row) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    try {
      deps.projectService.requireProjectAccess(c.var.user.userId, row.projectId);
    } catch {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    return row;
  };

  const bindingResponse = (sessionId: string): FeishuBindingResponse => {
    const row = deps.feishuRepo.find(sessionId);
    return {
      binding: row ? toBindingInfo(row) : null,
      status: deps.feishu.statusOf(sessionId),
    };
  };

  app.get("/:sessionId/feishu", (c) => {
    const row = resolveSession(c);
    return c.json(bindingResponse(row.sessionId));
  });

  app.put("/:sessionId/feishu", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const appId = requireString(body, "appId", { minLen: 1, maxLen: 200 }).trim();
    if (appId === "") throw badRequest("appId must not be blank.");
    const secretInput = optionalString(body, "appSecret", { maxLen: 500 })?.trim();
    const baseDomain = parseBaseDomain(optionalString(body, "baseDomain", { maxLen: 500 }));
    const enabledRaw = (body as Record<string, unknown>).enabled;
    if (enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
      throw badRequest("enabled must be a boolean.");
    }
    const enabled = enabledRaw ?? true;
    const existing = deps.feishuRepo.find(row.sessionId);
    // Omitted/blank keeps the stored secret; a first-time bind must carry one.
    const appSecret =
      secretInput !== undefined && secretInput !== "" ? secretInput : existing?.appSecret;
    if (appSecret === undefined) {
      throw new HttpError(400, "feishu_secret_required", "appSecret is required to bind.");
    }
    const result = deps.feishuRepo.upsert({
      sessionId: row.sessionId,
      appId,
      appSecret,
      baseDomain,
      enabled,
    });
    if (!result.ok) {
      throw new HttpError(
        409,
        "feishu_app_in_use",
        "This Feishu app is already bound to another Session.",
      );
    }
    // Bring the long connection in line with the saved row (connect / reconnect / disconnect).
    await deps.feishu.sync(row.sessionId);
    return c.json(bindingResponse(row.sessionId));
  });

  app.delete("/:sessionId/feishu", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    deps.feishu.unbind(row.sessionId);
    return c.body(null, 204);
  });

  // Credential test with the request's draft values, each falling back to the stored
  // binding: the form can probe before saving without ever round-tripping the secret.
  app.post("/:sessionId/feishu/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = deps.feishuRepo.find(row.sessionId);
    const appId = optionalString(body, "appId", { maxLen: 200 })?.trim() || stored?.appId;
    const appSecret =
      optionalString(body, "appSecret", { maxLen: 500 })?.trim() || stored?.appSecret;
    const rawDomain = optionalString(body, "baseDomain", { maxLen: 500 })?.trim();
    const baseDomain = parseBaseDomain(
      rawDomain !== undefined && rawDomain !== "" ? rawDomain : stored?.baseDomain,
    );
    if (appId === undefined || appId === "") {
      throw badRequest("appId is required (no stored binding to fall back to).");
    }
    if (appSecret === undefined || appSecret === "") {
      throw new HttpError(400, "feishu_secret_required", "appSecret is required to test.");
    }
    const result = await deps.feishu.testCredentials({ appId, appSecret, baseDomain });
    return c.json({
      ok: result.ok,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    } satisfies FeishuTestResponse);
  });

  // Short fixed text into the binding's last known chat: proves the outbound leg
  // end to end. Before any inbound message no chat is known — the UI explains that the
  // user must message the bot once in Feishu first.
  app.post("/:sessionId/feishu/test-message", async (c) => {
    const row = resolveSession(c);
    const binding = deps.feishuRepo.find(row.sessionId);
    if (!binding) {
      throw new HttpError(404, "feishu_not_bound", "This Session has no Feishu binding.");
    }
    if (binding.lastChatId === null) {
      throw new HttpError(
        409,
        "feishu_no_chat",
        "No Feishu chat is known yet: message the bot once in Feishu first.",
      );
    }
    try {
      await deps.feishu.sendTestMessage(binding);
    } catch (err) {
      throw new HttpError(
        502,
        "feishu_send_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    return c.json({ ok: true } satisfies FeishuTestMessageResponse);
  });

  return app;
}
