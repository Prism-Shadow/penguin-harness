/**
 * Messaging-binding routes: /api/sessions/:sessionId/messaging/feishu[...] — the binding
 * dialog's and the Messaging dock panel's shared surface (Feishu is the only channel
 * today; a future channel adds its own subtree with its own config shape).
 *
 * Authorization mirrors the vault's split, through the sessions routes' resolveSession
 * pattern (404 never leaks a Session's existence): any Project member can read bindings
 * and run the two tests; the secret-mutating writes — PUT and DELETE — are Project-owner-
 * only.
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
  MessagingBindingStateRequest,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { MessagingBindingRow } from "../../db/repos/messaging-bindings.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import { FEISHU_DEFAULT_DOMAIN, feishuConfigOf } from "../../runtime/messaging/feishu-connector.js";
import { maskApiKey } from "../../services/project-config-service.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import type { AppDeps } from "../../app.js";

/** The stored feishu config, tolerated loosely (a malformed document reads as blanks). */
function feishuFieldsOf(row: MessagingBindingRow): {
  appId: string;
  appSecret: string;
  baseDomain: string;
} {
  const { appId, appSecret, baseDomain } = row.config;
  return {
    appId: typeof appId === "string" ? appId : row.accountId,
    appSecret: typeof appSecret === "string" ? appSecret : "",
    baseDomain: typeof baseDomain === "string" ? baseDomain : FEISHU_DEFAULT_DOMAIN,
  };
}

function toBindingInfo(row: MessagingBindingRow): FeishuBindingInfo {
  const fields = feishuFieldsOf(row);
  return {
    sessionId: row.sessionId,
    appId: fields.appId,
    appSecretMasked: maskApiKey(fields.appSecret),
    baseDomain: fields.baseDomain,
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

/** Session-level entry: /api/sessions/:sessionId/messaging/feishu[...]. */
export function sessionMessagingRoutes(deps: AppDeps): Hono<AppEnv> {
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
    const row = deps.messagingRepo.find(sessionId);
    return {
      binding: row ? toBindingInfo(row) : null,
      status: deps.messaging.statusOf(sessionId),
    };
  };

  app.get("/:sessionId/messaging/feishu", (c) => {
    const row = resolveSession(c);
    return c.json(bindingResponse(row.sessionId));
  });

  app.put("/:sessionId/messaging/feishu", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const appId = requireString(body, "appId", { minLen: 1, maxLen: 200 }).trim();
    if (appId === "") throw badRequest("appId must not be blank.");
    const secretInput = optionalString(body, "appSecret", { maxLen: 500 })?.trim();
    const baseDomain = parseBaseDomain(optionalString(body, "baseDomain", { maxLen: 500 }));
    const existing = deps.messagingRepo.find(row.sessionId);
    // Omitted/blank keeps the stored secret; a first-time bind must carry one.
    const storedSecret =
      existing !== null ? feishuFieldsOf(existing).appSecret || undefined : undefined;
    const appSecret = secretInput !== undefined && secretInput !== "" ? secretInput : storedSecret;
    if (appSecret === undefined) {
      throw new HttpError(400, "feishu_secret_required", "appSecret is required to bind.");
    }
    const result = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "feishu",
      accountId: appId,
      config: { appId, appSecret, baseDomain },
    });
    if (!result.ok) {
      throw new HttpError(
        409,
        "feishu_app_in_use",
        "This Feishu app is already bound to another Session.",
      );
    }
    // Save persists credentials only and never flips the connection — with one deliberate
    // exception: an ENABLED binding's connector restarts with the new credentials, so the
    // stored config and the live connection never diverge. A disabled binding stays dark.
    if (result.row.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(bindingResponse(row.sessionId));
  });

  // The state toggle: enabling connects with the STORED credentials, disabling terminates
  // the connection. Separate from PUT on purpose — saving and connecting are different
  // intents, and the toggle must work without re-submitting any credential.
  app.post("/:sessionId/messaging/feishu/state", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const enabled = (body as Partial<MessagingBindingStateRequest>).enabled;
    if (typeof enabled !== "boolean") throw badRequest("enabled must be a boolean.");
    const binding = deps.messagingRepo.find(row.sessionId);
    if (!binding) {
      throw new HttpError(404, "feishu_not_bound", "This Session has no Feishu binding.");
    }
    deps.messagingRepo.setEnabled(row.sessionId, enabled);
    await deps.messaging.sync(row.sessionId);
    return c.json(bindingResponse(row.sessionId));
  });

  app.delete("/:sessionId/messaging/feishu", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    deps.messaging.unbind(row.sessionId);
    return c.body(null, 204);
  });

  // Credential test with the request's draft values, each falling back to the stored
  // binding: the form can probe before saving without ever round-tripping the secret.
  app.post("/:sessionId/messaging/feishu/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = deps.messagingRepo.find(row.sessionId);
    const storedFields = stored !== null ? feishuFieldsOf(stored) : null;
    const appId = optionalString(body, "appId", { maxLen: 200 })?.trim() || storedFields?.appId;
    const appSecret =
      optionalString(body, "appSecret", { maxLen: 500 })?.trim() || storedFields?.appSecret;
    const rawDomain = optionalString(body, "baseDomain", { maxLen: 500 })?.trim();
    const baseDomain = parseBaseDomain(
      rawDomain !== undefined && rawDomain !== "" ? rawDomain : storedFields?.baseDomain,
    );
    if (appId === undefined || appId === "") {
      throw badRequest("appId is required (no stored binding to fall back to).");
    }
    if (appSecret === undefined || appSecret === "") {
      throw new HttpError(400, "feishu_secret_required", "appSecret is required to test.");
    }
    const result = await deps.messaging.testCredentials("feishu", { appId, appSecret, baseDomain });
    return c.json({
      ok: result.ok,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    } satisfies FeishuTestResponse);
  });

  // Short fixed text into the binding's last known chat: proves the outbound leg
  // end to end. Before any inbound message no chat is known — the UI explains that the
  // user must message the bot once in Feishu first.
  app.post("/:sessionId/messaging/feishu/test-message", async (c) => {
    const row = resolveSession(c);
    const binding = deps.messagingRepo.find(row.sessionId);
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
      await deps.messaging.sendTestMessage(binding);
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
