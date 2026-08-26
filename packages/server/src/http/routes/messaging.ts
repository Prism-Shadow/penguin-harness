/**
 * Messaging-binding routes: /api/sessions/:sessionId/messaging[...] — the binding
 * editor's and the Messaging dock panel's shared surface. The channel-agnostic GET reads
 * whichever binding the Session has (the channel-aware editor decides what to render
 * from it); each channel then owns a subtree with its own config shape — /feishu and
 * /telegram carry the same verb set, and a further channel adds its own.
 *
 * Authorization mirrors the vault's split, through the sessions routes' resolveSession
 * pattern (404 never leaks a Session's existence): any Project member can read bindings
 * and run the two tests; the secret-mutating writes — PUT, the state toggle and DELETE —
 * are Project-owner-only.
 *
 * Round-trip rule for secrets: GET only ever returns the masked value, and a PUT whose
 * secret (feishu `appSecret`, telegram `botToken`) is omitted or blank keeps the stored
 * one (the same never-round-trip-masked-keys convention as the models test endpoint), so
 * the plaintext exists only at first entry.
 *
 * A channel subtree sees only its own channel's binding: bound to another channel, its
 * GET reads as unbound (and disconnected — the live connection belongs to the other
 * channel), state/test-message answer 404 not-bound, DELETE is a no-op, and PUT replaces
 * the binding outright (one binding per Session; the web UI's channel selector locks
 * once bound, so a cross-channel PUT is an explicit API-level rebind).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  FeishuBindingInfo,
  FeishuBindingResponse,
  FeishuTestResponse,
  MessagingBindingInfo,
  MessagingBindingResponse,
  MessagingBindingStateRequest,
  MessagingTestMessageResponse,
  TelegramBindingInfo,
  TelegramBindingResponse,
  TelegramTestResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { MessagingBindingRow } from "../../db/repos/messaging-bindings.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import { FEISHU_DEFAULT_DOMAIN, feishuConfigOf } from "../../runtime/messaging/feishu-connector.js";
import { telegramBotIdOf } from "../../runtime/messaging/telegram-connector.js";
import { maskApiKey } from "../../services/project-config-service.js";
import { HttpError } from "../errors.js";
import { badRequest, optionalString, readJson, requireString } from "../validate.js";
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

/** The stored telegram config, tolerated loosely (a malformed document reads as blank). */
function telegramFieldsOf(row: MessagingBindingRow): { botToken: string } {
  const { botToken } = row.config;
  return { botToken: typeof botToken === "string" ? botToken : "" };
}

function toFeishuInfo(row: MessagingBindingRow): FeishuBindingInfo {
  const fields = feishuFieldsOf(row);
  return {
    channel: "feishu",
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

function toTelegramInfo(row: MessagingBindingRow): TelegramBindingInfo {
  return {
    channel: "telegram",
    sessionId: row.sessionId,
    botId: row.accountId,
    botTokenMasked: maskApiKey(telegramFieldsOf(row).botToken),
    enabled: row.enabled,
    lastChatKnown: row.lastChatId !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Whatever channel the row is: its masked view, or null on an unknown discriminator (skipped defensively, like the bridge does). */
function toBindingInfo(row: MessagingBindingRow): MessagingBindingInfo | null {
  if (row.channel === "feishu") return toFeishuInfo(row);
  if (row.channel === "telegram") return toTelegramInfo(row);
  return null;
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

/** Session-level entry: /api/sessions/:sessionId/messaging[...]. */
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

  /** The Session's binding of ONE channel; a binding on another channel reads as unbound + dark. */
  const channelRow = (sessionId: string, channel: string): MessagingBindingRow | null => {
    const row = deps.messagingRepo.find(sessionId);
    return row !== null && row.channel === channel ? row : null;
  };

  const feishuResponse = (sessionId: string): FeishuBindingResponse => {
    const row = channelRow(sessionId, "feishu");
    return {
      binding: row ? toFeishuInfo(row) : null,
      status: row ? deps.messaging.statusOf(sessionId) : { state: "disconnected" },
    };
  };

  const telegramResponse = (sessionId: string): TelegramBindingResponse => {
    const row = channelRow(sessionId, "telegram");
    return {
      binding: row ? toTelegramInfo(row) : null,
      status: row ? deps.messaging.statusOf(sessionId) : { state: "disconnected" },
    };
  };

  // The channel-agnostic read: whichever channel is bound. The channel-aware binding
  // editor loads this one endpoint and renders the right per-channel form from it.
  app.get("/:sessionId/messaging", (c) => {
    const row = resolveSession(c);
    const stored = deps.messagingRepo.find(row.sessionId);
    const binding = stored ? toBindingInfo(stored) : null;
    return c.json({
      binding,
      status: binding !== null ? deps.messaging.statusOf(row.sessionId) : { state: "disconnected" },
    } satisfies MessagingBindingResponse);
  });

  // —— Feishu ————————————————————————————————————————————————————————————————

  app.get("/:sessionId/messaging/feishu", (c) => {
    const row = resolveSession(c);
    return c.json(feishuResponse(row.sessionId));
  });

  app.put("/:sessionId/messaging/feishu", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const appId = requireString(body, "appId", { minLen: 1, maxLen: 200 }).trim();
    if (appId === "") throw badRequest("appId must not be blank.");
    const secretInput = optionalString(body, "appSecret", { maxLen: 500 })?.trim();
    const baseDomain = parseBaseDomain(optionalString(body, "baseDomain", { maxLen: 500 }));
    const existing = channelRow(row.sessionId, "feishu");
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
    return c.json(feishuResponse(row.sessionId));
  });

  // The state toggle: enabling connects with the STORED credentials, disabling terminates
  // the connection. Separate from PUT on purpose — saving and connecting are different
  // intents, and the toggle must work without re-submitting any credential.
  app.post("/:sessionId/messaging/feishu/state", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const enabled = await readStateBody(c);
    if (channelRow(row.sessionId, "feishu") === null) {
      throw new HttpError(404, "feishu_not_bound", "This Session has no Feishu binding.");
    }
    deps.messagingRepo.setEnabled(row.sessionId, enabled);
    await deps.messaging.sync(row.sessionId);
    return c.json(feishuResponse(row.sessionId));
  });

  app.delete("/:sessionId/messaging/feishu", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    // Unbinds only this channel's binding: a binding on another channel is not touched
    // (deleting an absent binding is already a 204 no-op, and this keeps it one).
    if (channelRow(row.sessionId, "feishu") !== null) deps.messaging.unbind(row.sessionId);
    return c.body(null, 204);
  });

  // Credential test with the request's draft values, each falling back to the stored
  // binding: the form can probe before saving without ever round-tripping the secret.
  app.post("/:sessionId/messaging/feishu/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = channelRow(row.sessionId, "feishu");
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
    const binding = channelRow(row.sessionId, "feishu");
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
    return c.json({ ok: true } satisfies MessagingTestMessageResponse);
  });

  // —— Telegram ——————————————————————————————————————————————————————————————

  app.get("/:sessionId/messaging/telegram", (c) => {
    const row = resolveSession(c);
    return c.json(telegramResponse(row.sessionId));
  });

  app.put("/:sessionId/messaging/telegram", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const tokenInput = optionalString(body, "botToken", { maxLen: 200 })?.trim();
    const existing = channelRow(row.sessionId, "telegram");
    // Omitted/blank keeps the stored token; a first-time bind must carry one.
    const storedToken =
      existing !== null ? telegramFieldsOf(existing).botToken || undefined : undefined;
    const botToken = tokenInput !== undefined && tokenInput !== "" ? tokenInput : storedToken;
    if (botToken === undefined) {
      throw new HttpError(400, "telegram_token_required", "botToken is required to bind.");
    }
    // The id half in front of the colon is the account identity the uniqueness rule
    // hangs on, so a token it cannot be read from is refused rather than stored.
    const botId = telegramBotIdOf(botToken);
    if (botId === null) {
      throw new HttpError(
        400,
        "telegram_token_invalid",
        "botToken must look like <numeric bot id>:<secret> (as issued by @BotFather).",
      );
    }
    const result = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "telegram",
      accountId: botId,
      config: { botToken },
    });
    if (!result.ok) {
      throw new HttpError(
        409,
        "telegram_bot_in_use",
        "This Telegram bot is already bound to another Session.",
      );
    }
    // Same save/enable split as Feishu: only an enabled binding restarts its connector.
    if (result.row.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(telegramResponse(row.sessionId));
  });

  app.post("/:sessionId/messaging/telegram/state", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const enabled = await readStateBody(c);
    if (channelRow(row.sessionId, "telegram") === null) {
      throw new HttpError(404, "telegram_not_bound", "This Session has no Telegram binding.");
    }
    deps.messagingRepo.setEnabled(row.sessionId, enabled);
    await deps.messaging.sync(row.sessionId);
    return c.json(telegramResponse(row.sessionId));
  });

  app.delete("/:sessionId/messaging/telegram", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    if (channelRow(row.sessionId, "telegram") !== null) deps.messaging.unbind(row.sessionId);
    return c.body(null, 204);
  });

  // Credential test: the draft token, falling back to the stored one — and the success
  // feedback names the bot (`getMe`'s username), which is the confirmation a user can
  // actually check against @BotFather.
  app.post("/:sessionId/messaging/telegram/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = channelRow(row.sessionId, "telegram");
    const botToken =
      optionalString(body, "botToken", { maxLen: 200 })?.trim() ||
      (stored !== null ? telegramFieldsOf(stored).botToken || undefined : undefined);
    if (botToken === undefined || botToken === "") {
      throw new HttpError(400, "telegram_token_required", "botToken is required to test.");
    }
    const result = await deps.messaging.testCredentials("telegram", { botToken });
    return c.json({
      ok: result.ok,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.accountLabel !== undefined ? { botUsername: result.accountLabel } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    } satisfies TelegramTestResponse);
  });

  app.post("/:sessionId/messaging/telegram/test-message", async (c) => {
    const row = resolveSession(c);
    const binding = channelRow(row.sessionId, "telegram");
    if (!binding) {
      throw new HttpError(404, "telegram_not_bound", "This Session has no Telegram binding.");
    }
    if (binding.lastChatId === null) {
      throw new HttpError(
        409,
        "telegram_no_chat",
        "No Telegram chat is known yet: message the bot once in Telegram first.",
      );
    }
    try {
      await deps.messaging.sendTestMessage(binding);
    } catch (err) {
      throw new HttpError(
        502,
        "telegram_send_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    return c.json({ ok: true } satisfies MessagingTestMessageResponse);
  });

  return app;
}

/** The state toggle's `{enabled}` body, shared by both channels. */
async function readStateBody(c: Context<AppEnv>): Promise<boolean> {
  const body = await readJson(c);
  const enabled = (body as Partial<MessagingBindingStateRequest>).enabled;
  if (typeof enabled !== "boolean") throw badRequest("enabled must be a boolean.");
  return enabled;
}
