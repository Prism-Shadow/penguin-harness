/**
 * Messaging-binding routes: /api/sessions/:sessionId/messaging[...] — the binding
 * editor's and the Messaging dock panel's shared surface. A Session keeps at most one
 * saved config PER channel (all of them may sit saved side by side); the channel-agnostic
 * GET returns them all, and each channel owns a subtree with its own config shape —
 * /feishu, /telegram and /qq carry the same verb set, and a further channel adds its own.
 *
 * ENABLING the connection IS the binding, and disabling it is the unbind. Saving
 * credentials therefore never conflicts across Sessions — any number of Sessions may keep
 * the same Feishu app or Telegram bot saved, each with its own config and last-chat
 * memory — and both exclusivity rules sit on the state toggle instead: it refuses to
 * enable a channel while another channel of the SAME Session is enabled (409
 * `another_channel_enabled`), and to enable an account ANOTHER Session already has
 * enabled (409 `account_enabled_elsewhere` — one account has one event stream, so two
 * live connections on it would race). A config whose secret is missing is refused with
 * its channel's 400.
 *
 * Authorization mirrors the vault's split, through the sessions routes' resolveSession
 * pattern (404 never leaks a Session's existence): any Project member can read bindings
 * and run the two tests; the secret-mutating writes — PUT, the state toggle and DELETE —
 * are Project-owner-only.
 *
 * A PUT also carries `linePerMessage`, the one saved field that is not a credential: whether
 * a relayed reply is delivered one message per non-blank line. It is an ordinary form field
 * applied on Save — omitted keeps the stored value — and it never touches the connection.
 *
 * Round-trip rule for secrets: GET only ever returns the masked value, and a PUT whose
 * secret (feishu `appSecret`, telegram `botToken`, qq `appSecret`) is omitted or blank keeps the stored
 * one (the same never-round-trip-masked-keys convention as the models test endpoint), so
 * the plaintext exists only at first entry. Dropping a stored secret is the explicit
 * clear flag (the models-page idiom), refused while the binding is enabled — the cleared
 * config's row and account identity stay; full removal is the DELETE, which the web UI
 * no longer offers (API completeness only).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  FeishuBindingInfo,
  FeishuBindingResponse,
  FeishuTestResponse,
  MessagingBindingInfo,
  MessagingBindingsResponse,
  MessagingBindingStateRequest,
  MessagingChannelState,
  MessagingTestMessageResponse,
  QQBindingInfo,
  QQBindingResponse,
  QQTestResponse,
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
import {
  badRequest,
  optionalBoolean,
  optionalString,
  readJson,
  requireString,
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

/** The stored telegram config, tolerated loosely (a malformed document reads as blank). */
function telegramFieldsOf(row: MessagingBindingRow): { botToken: string } {
  const { botToken } = row.config;
  return { botToken: typeof botToken === "string" ? botToken : "" };
}

/** The stored qq config, tolerated loosely (a malformed document reads as blanks). */
function qqFieldsOf(row: MessagingBindingRow): { appId: string; appSecret: string } {
  const { appId, appSecret } = row.config;
  return {
    appId: typeof appId === "string" ? appId : row.accountId,
    appSecret: typeof appSecret === "string" ? appSecret : "",
  };
}

function toFeishuInfo(row: MessagingBindingRow): FeishuBindingInfo {
  const fields = feishuFieldsOf(row);
  return {
    channel: "feishu",
    sessionId: row.sessionId,
    appId: fields.appId,
    // A cleared/never-entered secret has no mask: the field's absence is what tells the
    // editor to render "not configured" instead of a masked placeholder.
    ...(fields.appSecret !== "" ? { appSecretMasked: maskApiKey(fields.appSecret) } : {}),
    baseDomain: fields.baseDomain,
    enabled: row.enabled,
    linePerMessage: row.linePerMessage,
    lastChatKnown: row.lastChatId !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTelegramInfo(row: MessagingBindingRow): TelegramBindingInfo {
  const { botToken } = telegramFieldsOf(row);
  return {
    channel: "telegram",
    sessionId: row.sessionId,
    botId: row.accountId,
    ...(botToken !== "" ? { botTokenMasked: maskApiKey(botToken) } : {}),
    enabled: row.enabled,
    linePerMessage: row.linePerMessage,
    lastChatKnown: row.lastChatId !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toQQInfo(row: MessagingBindingRow): QQBindingInfo {
  const fields = qqFieldsOf(row);
  return {
    channel: "qq",
    sessionId: row.sessionId,
    appId: fields.appId,
    ...(fields.appSecret !== "" ? { appSecretMasked: maskApiKey(fields.appSecret) } : {}),
    enabled: row.enabled,
    linePerMessage: row.linePerMessage,
    lastChatKnown: row.lastChatId !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Whatever channel the row is: its masked view, or null on an unknown discriminator (skipped defensively, like the bridge does). */
function toBindingInfo(row: MessagingBindingRow): MessagingBindingInfo | null {
  if (row.channel === "feishu") return toFeishuInfo(row);
  if (row.channel === "telegram") return toTelegramInfo(row);
  if (row.channel === "qq") return toQQInfo(row);
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

  const feishuResponse = (sessionId: string): FeishuBindingResponse => {
    const row = deps.messagingRepo.find(sessionId, "feishu");
    return {
      binding: row ? toFeishuInfo(row) : null,
      status: deps.messaging.statusOf(sessionId, "feishu"),
    };
  };

  const telegramResponse = (sessionId: string): TelegramBindingResponse => {
    const row = deps.messagingRepo.find(sessionId, "telegram");
    return {
      binding: row ? toTelegramInfo(row) : null,
      status: deps.messaging.statusOf(sessionId, "telegram"),
    };
  };

  const qqResponse = (sessionId: string): QQBindingResponse => {
    const row = deps.messagingRepo.find(sessionId, "qq");
    return {
      binding: row ? toQQInfo(row) : null,
      status: deps.messaging.statusOf(sessionId, "qq"),
    };
  };

  /**
   * The one-connection-per-account rule, on its own because two paths need it: the enable,
   * and a save that would carry an already-live connection onto a different account.
   *
   * The refusal says nothing about who holds the connection, on purpose. Authorization
   * here proved access to the CALLER's Session only; the holder may sit in a Project this
   * user cannot see, so its title or id would be a leak — and the remedy, turning that
   * connection off where it is on, does not depend on hearing it named.
   */
  const guardAccountFree = (sessionId: string, channel: string, accountId: string): void => {
    const holder = deps.messagingRepo.findEnabledByAccount(channel, accountId);
    if (holder === null || holder.sessionId === sessionId) return;
    // A holder whose Session is gone — deleted with its Project or its Agent, neither of
    // which sweeps bindings — would make this refusal a dead end: it names no Session by
    // design, and the remedy it offers is to turn off a connection that no longer exists.
    // Reconcile it here the way start() does on boot, so the account is released now
    // rather than at the next restart.
    if (deps.sessionsRepo.findById(holder.sessionId) === null) {
      deps.messagingRepo.delete(holder.sessionId, channel);
      return;
    }
    throw new HttpError(
      409,
      "account_enabled_elsewhere",
      "Another Session has this bot's connection enabled: turn it off there first.",
    );
  };

  /**
   * Everything checked before an enable flips intent: the one-enabled-per-session rule,
   * the one-connection-per-account rule across Sessions, and the secret prerequisite.
   * Disabling is never gated — it is the unbind, the only way to release an account.
   */
  const guardEnable = (sessionId: string, channel: string, row: MessagingBindingRow): void => {
    const enabledRow = deps.messagingRepo.findEnabled(sessionId);
    if (enabledRow !== null && enabledRow.channel !== channel) {
      throw new HttpError(
        409,
        "another_channel_enabled",
        "Another channel's connection is enabled on this Session: disable it first.",
      );
    }
    guardAccountFree(sessionId, channel, row.accountId);
    const secret =
      channel === "feishu"
        ? feishuFieldsOf(row).appSecret
        : channel === "qq"
          ? qqFieldsOf(row).appSecret
          : telegramFieldsOf(row).botToken;
    if (secret === "") {
      const code =
        channel === "feishu"
          ? "feishu_secret_required"
          : channel === "qq"
            ? "qq_secret_required"
            : "telegram_token_required";
      throw new HttpError(400, code, "The stored config has no credential: save one first.");
    }
  };

  // The channel-agnostic read: every saved channel config with its runtime status. The
  // channel-aware binding editor loads this one endpoint and renders both channel forms
  // (and the at-most-one-enabled state) from it.
  app.get("/:sessionId/messaging", (c) => {
    const row = resolveSession(c);
    const bindings: MessagingChannelState[] = [];
    for (const stored of deps.messagingRepo.listForSession(row.sessionId)) {
      const binding = toBindingInfo(stored);
      if (binding === null) continue;
      bindings.push({ binding, status: deps.messaging.statusOf(row.sessionId, stored.channel) });
    }
    return c.json({ bindings } satisfies MessagingBindingsResponse);
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
    const clearSecret = (body as { clearAppSecret?: unknown }).clearAppSecret === true;
    const baseDomain = parseBaseDomain(optionalString(body, "baseDomain", { maxLen: 500 }));
    const linePerMessage = optionalBoolean(body, "linePerMessage");
    const existing = deps.messagingRepo.find(row.sessionId, "feishu");
    const typed = secretInput !== undefined && secretInput !== "" ? secretInput : undefined;
    // Blank keeps the stored secret; the clear flag (models idiom — a typed secret wins
    // over it) drops it, refused while the binding is enabled: a live connection must
    // never be running on a credential the store no longer has.
    let appSecret: string;
    if (typed !== undefined) appSecret = typed;
    else if (clearSecret && existing !== null) {
      if (existing.enabled) {
        throw new HttpError(
          409,
          "messaging_disable_before_clear",
          "Disable the connection before clearing its credential.",
        );
      }
      appSecret = "";
    } else {
      const stored = existing !== null ? feishuFieldsOf(existing).appSecret : "";
      if (stored === "") {
        throw new HttpError(400, "feishu_secret_required", "appSecret is required to bind.");
      }
      appSecret = stored;
    }
    // A save never enables — but an ENABLED binding re-pointed at another app keeps its
    // connection and restarts it below, which would stand two Sessions on one app without
    // ever passing the enable gate. Exclusivity is therefore asked here too, of the app
    // this write would land on. A disabled binding stays exempt: that is the whole point
    // of enabling being the binding, and its own enable is still gated.
    if (existing !== null && existing.enabled) guardAccountFree(row.sessionId, "feishu", appId);
    const saved = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "feishu",
      accountId: appId,
      config: { appId, appSecret, baseDomain },
      ...(linePerMessage !== undefined ? { linePerMessage } : {}),
    });
    // Save persists credentials only and never flips the connection — with one deliberate
    // exception: an ENABLED binding's connector restarts with the new credentials, so the
    // stored config and the live connection never diverge. A disabled binding stays dark,
    // whoever else has the same app saved or even connected: only the enable is exclusive.
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(feishuResponse(row.sessionId));
  });

  // The state toggle: enabling connects with the STORED credentials, disabling terminates
  // the connection. Separate from PUT on purpose — saving and connecting are different
  // intents, and the toggle must work without re-submitting any credential.
  app.post("/:sessionId/messaging/feishu/state", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const enabled = await readStateBody(c);
    const binding = deps.messagingRepo.find(row.sessionId, "feishu");
    if (binding === null) {
      throw new HttpError(404, "feishu_not_bound", "This Session has no Feishu binding.");
    }
    if (enabled) guardEnable(row.sessionId, "feishu", binding);
    deps.messagingRepo.setEnabled(row.sessionId, "feishu", enabled);
    await deps.messaging.sync(row.sessionId);
    return c.json(feishuResponse(row.sessionId));
  });

  // Full removal of the channel's config. Kept for API completeness: the web UI's removal
  // affordance is the per-field clear (PUT clear flag), not this.
  app.delete("/:sessionId/messaging/feishu", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    deps.messaging.unbind(row.sessionId, "feishu");
    return c.body(null, 204);
  });

  // Credential test with the request's draft values, each falling back to the stored
  // binding: the form can probe before saving without ever round-tripping the secret.
  app.post("/:sessionId/messaging/feishu/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = deps.messagingRepo.find(row.sessionId, "feishu");
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
    const binding = deps.messagingRepo.find(row.sessionId, "feishu");
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
    const clearToken = (body as { clearBotToken?: unknown }).clearBotToken === true;
    const linePerMessage = optionalBoolean(body, "linePerMessage");
    const existing = deps.messagingRepo.find(row.sessionId, "telegram");
    const typed = tokenInput !== undefined && tokenInput !== "" ? tokenInput : undefined;
    // Same ladder as the Feishu PUT: typed wins, then the clear flag (disable first),
    // then the stored token; a first bind must carry one. A cleared config keeps its bot
    // identity — the token half in front of the colon never changes for a bot.
    let botToken: string;
    let botId: string;
    if (typed !== undefined) {
      const id = telegramBotIdOf(typed);
      if (id === null) {
        throw new HttpError(
          400,
          "telegram_token_invalid",
          "botToken must look like <numeric bot id>:<secret> (as issued by @BotFather).",
        );
      }
      botToken = typed;
      botId = id;
    } else if (clearToken && existing !== null) {
      if (existing.enabled) {
        throw new HttpError(
          409,
          "messaging_disable_before_clear",
          "Disable the connection before clearing its credential.",
        );
      }
      botToken = "";
      botId = existing.accountId;
    } else {
      const stored = existing !== null ? telegramFieldsOf(existing).botToken : "";
      if (stored === "" || existing === null) {
        throw new HttpError(400, "telegram_token_required", "botToken is required to bind.");
      }
      botToken = stored;
      botId = existing.accountId;
    }
    // Same reason as the Feishu PUT: a token swap on an enabled binding would carry the
    // live connection onto another bot without passing the enable gate.
    if (existing !== null && existing.enabled) guardAccountFree(row.sessionId, "telegram", botId);
    const saved = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "telegram",
      accountId: botId,
      config: { botToken },
      ...(linePerMessage !== undefined ? { linePerMessage } : {}),
    });
    // Same save/enable split as Feishu: only an enabled binding restarts its connector.
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(telegramResponse(row.sessionId));
  });

  app.post("/:sessionId/messaging/telegram/state", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const enabled = await readStateBody(c);
    const binding = deps.messagingRepo.find(row.sessionId, "telegram");
    if (binding === null) {
      throw new HttpError(404, "telegram_not_bound", "This Session has no Telegram binding.");
    }
    if (enabled) guardEnable(row.sessionId, "telegram", binding);
    deps.messagingRepo.setEnabled(row.sessionId, "telegram", enabled);
    await deps.messaging.sync(row.sessionId);
    return c.json(telegramResponse(row.sessionId));
  });

  app.delete("/:sessionId/messaging/telegram", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    deps.messaging.unbind(row.sessionId, "telegram");
    return c.body(null, 204);
  });

  // Credential test: the draft token, falling back to the stored one — and the success
  // feedback names the bot (`getMe`'s username), which is the confirmation a user can
  // actually check against @BotFather.
  app.post("/:sessionId/messaging/telegram/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = deps.messagingRepo.find(row.sessionId, "telegram");
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
      // The probe answers "does this bot read group messages"; the response states the
      // BotFather setting behind it, which is the name the user has to go and look for.
      ...(result.readsGroupMessages !== undefined
        ? { groupPrivacy: !result.readsGroupMessages }
        : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    } satisfies TelegramTestResponse);
  });

  app.post("/:sessionId/messaging/telegram/test-message", async (c) => {
    const row = resolveSession(c);
    const binding = deps.messagingRepo.find(row.sessionId, "telegram");
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

  // —— QQ ————————————————————————————————————————————————————————————————————
  //
  // Same verb set and the same save/enable split as the two channels above; the config is
  // the App ID / App Secret pair from the QQ developer console, and the App ID is the
  // account identity (the QQ analogue of the Feishu app id: stable, non-secret, and
  // unchanged by rotating the secret).

  app.get("/:sessionId/messaging/qq", (c) => {
    const row = resolveSession(c);
    return c.json(qqResponse(row.sessionId));
  });

  app.put("/:sessionId/messaging/qq", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const appId = requireString(body, "appId", { minLen: 1, maxLen: 200 }).trim();
    if (appId === "") throw badRequest("appId must not be blank.");
    const secretInput = optionalString(body, "appSecret", { maxLen: 500 })?.trim();
    const clearSecret = (body as { clearAppSecret?: unknown }).clearAppSecret === true;
    const linePerMessage = optionalBoolean(body, "linePerMessage");
    const existing = deps.messagingRepo.find(row.sessionId, "qq");
    const typed = secretInput !== undefined && secretInput !== "" ? secretInput : undefined;
    // The same ladder as the other two channels: typed wins, then the clear flag (disable
    // first), then the stored secret; a first bind must carry one.
    let appSecret: string;
    if (typed !== undefined) appSecret = typed;
    else if (clearSecret && existing !== null) {
      if (existing.enabled) {
        throw new HttpError(
          409,
          "messaging_disable_before_clear",
          "Disable the connection before clearing its credential.",
        );
      }
      appSecret = "";
    } else {
      const stored = existing !== null ? qqFieldsOf(existing).appSecret : "";
      if (stored === "") {
        throw new HttpError(400, "qq_secret_required", "appSecret is required to bind.");
      }
      appSecret = stored;
    }
    const saved = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "qq",
      accountId: appId,
      config: { appId, appSecret },
      ...(linePerMessage !== undefined ? { linePerMessage } : {}),
    });
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(qqResponse(row.sessionId));
  });

  app.post("/:sessionId/messaging/qq/state", async (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    const enabled = await readStateBody(c);
    const binding = deps.messagingRepo.find(row.sessionId, "qq");
    if (binding === null) {
      throw new HttpError(404, "qq_not_bound", "This Session has no QQ binding.");
    }
    if (enabled) guardEnable(row.sessionId, "qq", binding);
    deps.messagingRepo.setEnabled(row.sessionId, "qq", enabled);
    await deps.messaging.sync(row.sessionId);
    return c.json(qqResponse(row.sessionId));
  });

  app.delete("/:sessionId/messaging/qq", (c) => {
    const row = resolveSession(c);
    deps.projectService.requireProjectOwner(c.var.user.userId, row.projectId);
    deps.messaging.unbind(row.sessionId, "qq");
    return c.body(null, 204);
  });

  // Credential probe: the access-token exchange, which is the only credential call the
  // platform has. It names no account, so the response carries no label — unlike Telegram's.
  app.post("/:sessionId/messaging/qq/test", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const stored = deps.messagingRepo.find(row.sessionId, "qq");
    const storedFields = stored !== null ? qqFieldsOf(stored) : null;
    const appId = optionalString(body, "appId", { maxLen: 200 })?.trim() || storedFields?.appId;
    const appSecret =
      optionalString(body, "appSecret", { maxLen: 500 })?.trim() || storedFields?.appSecret;
    if (appId === undefined || appId === "") {
      throw badRequest("appId is required (no stored binding to fall back to).");
    }
    if (appSecret === undefined || appSecret === "") {
      throw new HttpError(400, "qq_secret_required", "appSecret is required to test.");
    }
    const result = await deps.messaging.testCredentials("qq", { appId, appSecret });
    return c.json({
      ok: result.ok,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    } satisfies QQTestResponse);
  });

  // The one test endpoint that means something different here. On Feishu and Telegram a
  // known chat is enough to send into; on QQ a message may only be sent as a reply to one
  // the user sent minutes ago, so the 409 below is the weaker of two gates and the send can
  // still fail with 502 `qq_send_failed` naming the window. The message text says so.
  app.post("/:sessionId/messaging/qq/test-message", async (c) => {
    const row = resolveSession(c);
    const binding = deps.messagingRepo.find(row.sessionId, "qq");
    if (!binding) {
      throw new HttpError(404, "qq_not_bound", "This Session has no QQ binding.");
    }
    if (binding.lastChatId === null) {
      throw new HttpError(
        409,
        "qq_no_chat",
        "No QQ chat is known yet: message the bot once in QQ first.",
      );
    }
    try {
      await deps.messaging.sendTestMessage(binding);
    } catch (err) {
      throw new HttpError(502, "qq_send_failed", err instanceof Error ? err.message : String(err));
    }
    return c.json({ ok: true } satisfies MessagingTestMessageResponse);
  });

  return app;
}

/** The state toggle's `{enabled}` body, shared by every channel. */
async function readStateBody(c: Context<AppEnv>): Promise<boolean> {
  const body = await readJson(c);
  const enabled = (body as Partial<MessagingBindingStateRequest>).enabled;
  if (typeof enabled !== "boolean") throw badRequest("enabled must be a boolean.");
  return enabled;
}
