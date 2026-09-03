/**
 * Messaging-binding routes: /api/sessions/:sessionId/messaging[...] — the binding
 * editor's and the Messaging dock panel's shared surface. A Session keeps at most one
 * saved config PER channel (all of them may sit saved side by side); the channel-agnostic
 * GET returns them all, and each channel owns a subtree with its own config shape —
 * /feishu, /telegram, /qq and /wechat carry the same verb set, and a further channel adds
 * its own.
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
 * Two channels offer a scan-to-connect flow, and the server holds what makes it safe in both:
 * QQ's (`/qq/scan…`) keeps the AES key that decrypts the App Secret, WeChat's
 * (`/wechat/scan…`) keeps the poll handle that collects the bot token. Each polls on the
 * browser's behalf and stores the result; the browser only ever learns a task handle, the URL
 * to render as a QR code, and the non-secret account id that came back — the same
 * never-round-trip-the-secret rule the PUT handlers follow, applied to a secret that arrives
 * from outside instead of from the user. On WeChat the scan is not the convenient path but
 * the ONLY one: there is no console to copy a token out of, so its PUT carries preferences
 * alone.
 *
 * A PUT also carries the three saved fields that are not credentials: `linePerMessage`
 * (whether a relayed reply is delivered one message per non-blank line), `finalReplyOnly`
 * (whether a run relays only its last completed assistant message, at the run's end, instead
 * of each one as it completes) and `renderMarkdown` (whether its Markdown is rendered in the
 * channel's own markup). All three are ordinary form fields applied on Save — omitted keeps
 * the stored value — and none touches the connection.
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
  QQScanPollResponse,
  QQScanStartResponse,
  QQTestResponse,
  TelegramBindingInfo,
  TelegramBindingResponse,
  TelegramTestResponse,
  WeChatBindingInfo,
  WeChatBindingResponse,
  WeChatScanPollResponse,
  WeChatScanStartResponse,
  WeChatTestResponse,
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
import {
  commonBindingFields,
  deliveryPatchOf,
  maskedSecretField,
  resolveSecret,
} from "./messaging-channels.js";
import type { MessagingChannelSpec } from "./messaging-channels.js";
import type { MessagingChannel } from "../../runtime/messaging/connector.js";
import type { MessagingBindingsRepo } from "../../db/repos/messaging-bindings.js";
import type { SessionsRepo } from "../../db/repos/sessions.js";
import type { MessagingBridge } from "../../runtime/messaging/bridge.js";
import type { QQScanService } from "../../runtime/messaging/qq-scan.js";
import type { WeChatScanService } from "../../runtime/messaging/wechat-scan.js";
import type { ProjectAccess } from "../../services/project-access.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MessagingRouteDeps {
  messaging: MessagingBridge;
  messagingRepo: MessagingBindingsRepo;
  access: ProjectAccess;
  qqScan: QQScanService;
  wechatScan: WeChatScanService;
  sessionsRepo: SessionsRepo;
}

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

/**
 * The stored wechat config, tolerated loosely (a malformed document reads as blanks).
 *
 * `baseUrl` and `userId` are not projected anywhere: the first is an infrastructure detail a
 * scan chose, and the second identifies the person who scanned. Neither is something the
 * editor renders or a caller may set, so they stay inside the document the connector reads.
 */
function wechatFieldsOf(row: MessagingBindingRow): { botId: string; botToken: string } {
  const { botId, botToken } = row.config;
  return {
    botId: typeof botId === "string" ? botId : row.accountId,
    botToken: typeof botToken === "string" ? botToken : "",
  };
}

/**
 * The four channels, each saying only what it does not share (see messaging-channels.ts).
 * Everything written against this table — the read, the state toggle, the delete, the test
 * message, the enable gate's credential check — is written once.
 *
 * A `Record` keyed by the discriminant rather than an array: every lookup here starts from a
 * channel already in hand, and a stored row's channel is untrusted text, so `?? null` on a
 * miss is the shape both callers want.
 */
const CHANNEL_SPECS: Readonly<Record<MessagingChannel, MessagingChannelSpec>> = {
  feishu: {
    channel: "feishu",
    label: "Feishu",
    storedSecret: (row) => feishuFieldsOf(row).appSecret,
    secretRequiredCode: "feishu_secret_required",
    toInfo: (row) => {
      const fields = feishuFieldsOf(row);
      return {
        channel: "feishu",
        ...commonBindingFields(row),
        appId: fields.appId,
        ...maskedSecretField("appSecretMasked", fields.appSecret),
        baseDomain: fields.baseDomain,
      };
    },
  },
  telegram: {
    channel: "telegram",
    label: "Telegram",
    storedSecret: (row) => telegramFieldsOf(row).botToken,
    secretRequiredCode: "telegram_token_required",
    toInfo: (row) => ({
      channel: "telegram",
      ...commonBindingFields(row),
      // The bot id is the row's account identity rather than a config field: it survives a
      // cleared token, because the half in front of a token's colon never changes for a bot.
      botId: row.accountId,
      ...maskedSecretField("botTokenMasked", telegramFieldsOf(row).botToken),
    }),
  },
  qq: {
    channel: "qq",
    label: "QQ",
    storedSecret: (row) => qqFieldsOf(row).appSecret,
    secretRequiredCode: "qq_secret_required",
    toInfo: (row) => {
      const fields = qqFieldsOf(row);
      return {
        channel: "qq",
        ...commonBindingFields(row),
        appId: fields.appId,
        ...maskedSecretField("appSecretMasked", fields.appSecret),
      };
    },
  },
  wechat: {
    channel: "wechat",
    label: "WeChat",
    storedSecret: (row) => wechatFieldsOf(row).botToken,
    secretRequiredCode: "wechat_token_required",
    toInfo: (row) => {
      const fields = wechatFieldsOf(row);
      return {
        channel: "wechat",
        ...commonBindingFields(row),
        // The bot id is the row's account identity as well as a config field: a cleared
        // token leaves the row still knowing which bot it was bound to.
        botId: fields.botId,
        ...maskedSecretField("botTokenMasked", fields.botToken),
      };
    },
  },
};

/** The spec for a stored row's channel, or null on an unknown discriminator (skipped defensively, like the bridge does). */
function specOf(channel: string): MessagingChannelSpec | null {
  return CHANNEL_SPECS[channel as MessagingChannel] ?? null;
}

/** Whatever channel the row is: its masked view, or null on an unknown discriminator. */
function toBindingInfo(row: MessagingBindingRow): MessagingBindingInfo | null {
  return specOf(row.channel)?.toInfo(row) ?? null;
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
export function sessionMessagingRoutes(deps: MessagingRouteDeps): Hono<AppEnv> {
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
      deps.access.requireProjectAccess(c.var.user.userId, row.projectId);
    } catch {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    return row;
  };

  /**
   * One channel's saved config plus its live connection status — the body every endpoint on
   * this router answers with, so a caller never has to ask twice to see the effect of what it
   * just did. Typed by the channel's own response so each route keeps its exact wire contract.
   */
  const bindingResponse = (sessionId: string, spec: MessagingChannelSpec) => {
    const row = deps.messagingRepo.find(sessionId, spec.channel);
    return {
      binding: row ? spec.toInfo(row) : null,
      status: deps.messaging.statusOf(sessionId, spec.channel),
    };
  };

  const feishuResponse = (sessionId: string): FeishuBindingResponse =>
    bindingResponse(sessionId, CHANNEL_SPECS.feishu) as FeishuBindingResponse;
  const telegramResponse = (sessionId: string): TelegramBindingResponse =>
    bindingResponse(sessionId, CHANNEL_SPECS.telegram) as TelegramBindingResponse;
  const qqResponse = (sessionId: string): QQBindingResponse =>
    bindingResponse(sessionId, CHANNEL_SPECS.qq) as QQBindingResponse;
  const wechatResponse = (sessionId: string): WeChatBindingResponse =>
    bindingResponse(sessionId, CHANNEL_SPECS.wechat) as WeChatBindingResponse;

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
    // An unknown discriminator cannot be enabled: nothing can connect it, and the spec table
    // is what says so. It is reachable only from a row written by a build that had a channel
    // this one does not.
    const spec = specOf(channel);
    if (spec === null || spec.storedSecret(row) === "") {
      throw new HttpError(
        400,
        spec?.secretRequiredCode ?? "messaging_channel_unknown",
        "The stored config has no credential: save one first.",
      );
    }
  };

  /**
   * The disable-first rule both scan flows start with. A server rule rather than a greyed-out
   * button: a scan rewrites the whole credential and would point a live connector at whatever
   * account was scanned, which the PUT's account guard exists to prevent it doing silently.
   */
  const guardScanStart = (sessionId: string, channel: MessagingChannel): void => {
    if (deps.messagingRepo.find(sessionId, channel)?.enabled === true) {
      throw new HttpError(
        409,
        "messaging_disable_before_scan",
        "Disable the connection before rebinding it by scan.",
      );
    }
  };

  /**
   * Storing what a completed scan produced — identical on both channels that have one, which
   * is why it is here rather than written twice.
   *
   * It stores only: enabling stays the separate act it is everywhere, because enabling is
   * what binds the account and is exclusive. The account guard runs because the start refused
   * an enabled binding and this fires anyway when the connection was switched on WHILE the
   * scan was in flight — an enabled binding re-pointed at an account another Session holds
   * would stand two connections on one bot's single event stream without either passing the
   * enable gate. The restart of an enabled connector is the same never-diverge rule the PUTs
   * follow.
   */
  const saveScanResult = async (
    sessionId: string,
    channel: MessagingChannel,
    accountId: string,
    config: Record<string, unknown>,
  ): Promise<MessagingBindingRow> => {
    const bound = deps.messagingRepo.find(sessionId, channel);
    if (bound !== null && bound.enabled) guardAccountFree(sessionId, channel, accountId);
    const saved = deps.messagingRepo.upsert({ sessionId, channel, accountId, config });
    if (saved.enabled) await deps.messaging.sync(sessionId);
    return saved;
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
  /**
   * The four endpoints every channel serves the same way, registered from the spec table so a
   * channel contributes a name to them and nothing else.
   *
   * They were written three times each, and what varied across the copies was the channel
   * literal and a `<channel>_` error-code prefix — which is to say nothing. What is NOT here
   * is as deliberate: the PUT and the credential test stay hand-written below, because their
   * inputs differ in more than a name and a table would only hide that.
   */
  const registerChannelRoutes = (spec: MessagingChannelSpec): void => {
    const base = `/:sessionId/messaging/${spec.channel}`;
    const notBound = (): never => {
      throw new HttpError(
        404,
        `${spec.channel}_not_bound`,
        `This Session has no ${spec.label} binding.`,
      );
    };
    const boundOr404 = (sessionId: string): MessagingBindingRow =>
      deps.messagingRepo.find(sessionId, spec.channel) ?? notBound();

    app.get(base, (c) => c.json(bindingResponse(resolveSession(c).sessionId, spec)));

    // The state toggle: enabling connects with the STORED credentials, disabling terminates
    // the connection. Separate from PUT on purpose — saving and connecting are different
    // intents, and the toggle must work without re-submitting any credential.
    app.post(`${base}/state`, async (c) => {
      const row = resolveSession(c);
      deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
      const enabled = await readStateBody(c);
      const binding = boundOr404(row.sessionId);
      if (enabled) guardEnable(row.sessionId, spec.channel, binding);
      deps.messagingRepo.setEnabled(row.sessionId, spec.channel, enabled);
      await deps.messaging.sync(row.sessionId);
      return c.json(bindingResponse(row.sessionId, spec));
    });

    // Full removal of the channel's config. Kept for API completeness: the web UI's removal
    // affordance is the per-field clear (PUT clear flag), not this.
    app.delete(base, (c) => {
      const row = resolveSession(c);
      deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
      deps.messaging.unbind(row.sessionId, spec.channel);
      return c.body(null, 204);
    });

    // Short fixed text into the binding's last known chat: proves the outbound leg end to
    // end. Before any inbound message no chat is known — the UI explains that the user must
    // message the bot once in the channel first.
    app.post(`${base}/test-message`, async (c) => {
      const row = resolveSession(c);
      const binding = boundOr404(row.sessionId);
      if (binding.lastChatId === null) {
        throw new HttpError(
          409,
          `${spec.channel}_no_chat`,
          `No ${spec.label} chat is known yet: message the bot once in ${spec.label} first.`,
        );
      }
      try {
        await deps.messaging.sendTestMessage(binding);
      } catch (err) {
        throw new HttpError(
          502,
          `${spec.channel}_send_failed`,
          err instanceof Error ? err.message : String(err),
        );
      }
      return c.json({ ok: true } satisfies MessagingTestMessageResponse);
    });
  };

  for (const spec of Object.values(CHANNEL_SPECS)) registerChannelRoutes(spec);

  app.put("/:sessionId/messaging/feishu", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const appId = requireString(body, "appId", { minLen: 1, maxLen: 200 }).trim();
    if (appId === "") throw badRequest("appId must not be blank.");
    const baseDomain = parseBaseDomain(optionalString(body, "baseDomain", { maxLen: 500 }));
    const existing = deps.messagingRepo.find(row.sessionId, "feishu");
    const { secret: appSecret } = resolveSecret({
      typed: optionalString(body, "appSecret", { maxLen: 500 })?.trim(),
      clear: (body as { clearAppSecret?: unknown }).clearAppSecret === true,
      existing,
      stored: existing !== null ? feishuFieldsOf(existing).appSecret : "",
      requiredCode: "feishu_secret_required",
      requiredMessage: "appSecret is required to bind.",
    });
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
      ...deliveryPatchOf(body),
    });
    // Save persists credentials only and never flips the connection — with one deliberate
    // exception: an ENABLED binding's connector restarts with the new credentials, so the
    // stored config and the live connection never diverge. A disabled binding stays dark,
    // whoever else has the same app saved or even connected: only the enable is exclusive.
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(feishuResponse(row.sessionId));
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

  app.put("/:sessionId/messaging/telegram", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const existing = deps.messagingRepo.find(row.sessionId, "telegram");
    const { secret: botToken, fromRequest } = resolveSecret({
      typed: optionalString(body, "botToken", { maxLen: 200 })?.trim(),
      clear: (body as { clearBotToken?: unknown }).clearBotToken === true,
      existing,
      stored: existing !== null ? telegramFieldsOf(existing).botToken : "",
      requiredCode: "telegram_token_required",
      requiredMessage: "botToken is required to bind.",
    });
    // The one channel whose account identity comes out of the credential rather than out of a
    // field of its own, so it is re-derived exactly when a new token arrives. Every other
    // branch keeps the row's identity: the half in front of a token's colon never changes for
    // a bot, so a cleared config still knows which bot it was.
    let botId: string;
    if (fromRequest) {
      const id = telegramBotIdOf(botToken);
      if (id === null) {
        throw new HttpError(
          400,
          "telegram_token_invalid",
          "botToken must look like <numeric bot id>:<secret> (as issued by @BotFather).",
        );
      }
      botId = id;
    } else {
      botId = existing!.accountId;
    }
    // Same reason as the Feishu PUT: a token swap on an enabled binding would carry the
    // live connection onto another bot without passing the enable gate.
    if (existing !== null && existing.enabled) guardAccountFree(row.sessionId, "telegram", botId);
    const saved = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "telegram",
      accountId: botId,
      config: { botToken },
      ...deliveryPatchOf(body),
    });
    // Same save/enable split as Feishu: only an enabled binding restarts its connector.
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(telegramResponse(row.sessionId));
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

  app.put("/:sessionId/messaging/qq", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const appId = requireString(body, "appId", { minLen: 1, maxLen: 200 }).trim();
    if (appId === "") throw badRequest("appId must not be blank.");
    const existing = deps.messagingRepo.find(row.sessionId, "qq");
    const { secret: appSecret } = resolveSecret({
      typed: optionalString(body, "appSecret", { maxLen: 500 })?.trim(),
      clear: (body as { clearAppSecret?: unknown }).clearAppSecret === true,
      existing,
      stored: existing !== null ? qqFieldsOf(existing).appSecret : "",
      requiredCode: "qq_secret_required",
      requiredMessage: "appSecret is required to bind.",
    });
    // Same reason as the Feishu and Telegram PUTs: an enabled binding re-pointed at another
    // App ID keeps its connection and restarts it below, which would stand two Sessions on
    // one bot's single gateway without either passing the enable gate.
    if (existing !== null && existing.enabled) guardAccountFree(row.sessionId, "qq", appId);
    const saved = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "qq",
      accountId: appId,
      config: { appId, appSecret },
      ...deliveryPatchOf(body),
    });
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(qqResponse(row.sessionId));
  });

  // —— QQ scan-to-connect ————————————————————————————————————————————————————
  //
  // The alternative to typing an App ID and an App Secret: the server registers a bind task
  // under a fresh AES key, the browser renders the returned URL as a QR code, the user scans
  // it in QQ, and the completed poll hands back the App Secret encrypted under that key.
  //
  // The key never leaves the server, which is what these three routes are shaped around: the
  // browser is given a task handle, a URL and a status, and the credentials it produces go
  // straight into storage without passing back through it. Owner-only throughout, like every
  // other write here — the flow ends in a stored secret, so it is a credential write however
  // little of it the caller types.

  app.post("/:sessionId/messaging/qq/scan", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    guardScanStart(row.sessionId, "qq");
    let started: { taskId: string; qrUrl: string; pollMs: number };
    try {
      started = await deps.qqScan.start(row.sessionId);
    } catch (err) {
      throw new HttpError(502, "qq_scan_failed", err instanceof Error ? err.message : String(err));
    }
    return c.json(started satisfies QQScanStartResponse);
  });

  app.post("/:sessionId/messaging/qq/scan/poll", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const taskId = requireString(body, "taskId", { minLen: 1, maxLen: 500 });
    let result: Awaited<ReturnType<typeof deps.qqScan.poll>>;
    try {
      result = await deps.qqScan.poll(row.sessionId, taskId);
    } catch (err) {
      throw new HttpError(502, "qq_scan_failed", err instanceof Error ? err.message : String(err));
    }
    // Unknown, another Session's, already resolved, or claimed by a poll still in flight —
    // neither a replay nor an overlapping poll may re-authorize.
    if (result === null) {
      throw new HttpError(
        404,
        "qq_scan_task_unknown",
        "This scan is no longer in progress: start a new one.",
      );
    }
    if (result.status !== "completed" || result.bot === undefined) {
      return c.json({ status: result.status } satisfies QQScanPollResponse);
    }
    // The scan landed: store it exactly as the PUT would (see saveScanResult).
    const saved = await saveScanResult(row.sessionId, "qq", result.bot.appId, {
      appId: result.bot.appId,
      appSecret: result.bot.appSecret,
    });
    return c.json({
      status: "completed",
      appId: result.bot.appId,
      binding: CHANNEL_SPECS.qq.toInfo(saved) as QQBindingInfo,
    } satisfies QQScanPollResponse);
  });

  app.post("/:sessionId/messaging/qq/scan/cancel", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    deps.qqScan.cancel(row.sessionId, requireString(body, "taskId", { minLen: 1, maxLen: 500 }));
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
  // —— WeChat ————————————————————————————————————————————————————————————————
  //
  // The channel with no credential to type. A bot token exists only where a scan put it —
  // there is no developer console for this channel and no pair of fields to fall back to —
  // so the PUT below carries the delivery preferences and nothing else, and the scan routes
  // are the whole of how a binding comes to exist.

  /**
   * Saves the delivery preferences. It presupposes a binding rather than creating one: with
   * no credential in the request there is nothing a first PUT could store, and a row written
   * without one could never be enabled.
   */
  app.put("/:sessionId/messaging/wechat", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const existing = deps.messagingRepo.find(row.sessionId, "wechat");
    if (existing === null) {
      throw new HttpError(
        400,
        "wechat_token_required",
        "Bind by scanning a QR code first: there is no saved WeChat config to update.",
      );
    }
    // The same ladder every channel climbs, entered one rung down: there is no typed
    // credential here, so it decides only between the clear flag and the stored token.
    const { secret: botToken } = resolveSecret({
      typed: undefined,
      clear: (body as { clearBotToken?: unknown }).clearBotToken === true,
      existing,
      stored: wechatFieldsOf(existing).botToken,
      requiredCode: "wechat_token_required",
      requiredMessage: "Bind by scanning a QR code first.",
    });
    const saved = deps.messagingRepo.upsert({
      sessionId: row.sessionId,
      channel: "wechat",
      accountId: existing.accountId,
      // The stored document carried forward with only the token replaced: it also holds the
      // API host the scan assigned and the id of the person who scanned, neither of which
      // this request knows and both of which the connector needs.
      config: { ...existing.config, botToken },
      ...deliveryPatchOf(body),
    });
    // Same save/enable split as every other channel: only an enabled binding restarts its
    // connector, so the stored config and the live connection never diverge.
    if (saved.enabled) await deps.messaging.sync(row.sessionId);
    return c.json(wechatResponse(row.sessionId));
  });

  // —— WeChat scan-to-connect ————————————————————————————————————————————————
  //
  // Four routes rather than QQ's three: WeChat may interpose a pairing code shown on the
  // phone, and the digits need somewhere to arrive. They ride the next poll rather than a
  // request of their own, because the platform takes the code as a parameter of its status
  // call — so `verify` records them and answers 204.
  //
  // Owner-only throughout, like every other write here: the flow ends in a stored credential,
  // so it is a credential write however little of it the caller types.

  app.post("/:sessionId/messaging/wechat/scan", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    guardScanStart(row.sessionId, "wechat");
    let started: { taskId: string; qrUrl: string; pollMs: number };
    try {
      started = await deps.wechatScan.start(row.sessionId);
    } catch (err) {
      throw new HttpError(
        502,
        "wechat_scan_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    return c.json(started satisfies WeChatScanStartResponse);
  });

  app.post("/:sessionId/messaging/wechat/scan/poll", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const taskId = requireString(body, "taskId", { minLen: 1, maxLen: 500 });
    let result: Awaited<ReturnType<typeof deps.wechatScan.poll>>;
    try {
      result = await deps.wechatScan.poll(row.sessionId, taskId);
    } catch (err) {
      throw new HttpError(
        502,
        "wechat_scan_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    // Unknown, another Session's, or already resolved. An overlapping poll is NOT this — the
    // upstream call is a long poll and the scan service answers those `pending` (see
    // wechat-scan.ts), so a client whose interval outpaces the platform is not an error.
    if (result === null) {
      throw new HttpError(
        404,
        "wechat_scan_task_unknown",
        "This scan is no longer in progress: start a new one.",
      );
    }
    if (result.status !== "completed" || result.bot === undefined) {
      return c.json({ status: result.status } satisfies WeChatScanPollResponse);
    }
    const { botId, botToken, baseUrl, userId } = result.bot;
    const saved = await saveScanResult(row.sessionId, "wechat", botId, {
      botId,
      botToken,
      baseUrl,
      userId,
    });
    return c.json({
      status: "completed",
      botId,
      binding: CHANNEL_SPECS.wechat.toInfo(saved) as WeChatBindingInfo,
    } satisfies WeChatScanPollResponse);
  });

  app.post("/:sessionId/messaging/wechat/scan/verify", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    const taskId = requireString(body, "taskId", { minLen: 1, maxLen: 500 });
    // The platform shows a short numeric code; the bound is generous rather than exact
    // because the length is not documented and a rejected digit is the platform's answer to
    // give, not this route's.
    const verifyCode = requireString(body, "verifyCode", { minLen: 1, maxLen: 32 }).trim();
    if (verifyCode === "") throw badRequest("verifyCode must not be blank.");
    if (!deps.wechatScan.submitVerifyCode(row.sessionId, taskId, verifyCode)) {
      throw new HttpError(
        404,
        "wechat_scan_task_unknown",
        "This scan is no longer in progress: start a new one.",
      );
    }
    return c.body(null, 204);
  });

  app.post("/:sessionId/messaging/wechat/scan/cancel", async (c) => {
    const row = resolveSession(c);
    deps.access.requireProjectOwner(c.var.user.userId, row.projectId);
    const body = await readJson(c);
    deps.wechatScan.cancel(
      row.sessionId,
      requireString(body, "taskId", { minLen: 1, maxLen: 500 }),
    );
    return c.body(null, 204);
  });

  /**
   * Credential probe. The only test on this router that takes no draft values: nothing here
   * is typed, so the stored binding is the only thing there is to probe.
   */
  app.post("/:sessionId/messaging/wechat/test", async (c) => {
    const row = resolveSession(c);
    const stored = deps.messagingRepo.find(row.sessionId, "wechat");
    if (stored === null || wechatFieldsOf(stored).botToken === "") {
      throw new HttpError(
        400,
        "wechat_token_required",
        "Bind by scanning a QR code first: there is no credential to test.",
      );
    }
    const result = await deps.messaging.testCredentials("wechat", stored.config);
    return c.json({
      ok: result.ok,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    } satisfies WeChatTestResponse);
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
