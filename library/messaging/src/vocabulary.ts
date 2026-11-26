/**
 * The messaging HTTP vocabulary: the wire shapes the messaging routes read and write
 * (services+http+cli restack S8). The api contract re-exports it so the API surface
 * keeps spelling it.
 */
// (/api/messaging/accounts, /api/projects/:projectId/messaging/account-holders)
// ---------------------------------------------------------------------------

/**
 * The chat channels a Session can be bound to. The definition lives with the session contract
 * (@prismshadow/penguin-library-session, services+http+cli restack S14 — SessionInfo names it);
 * re-exported here unchanged for the messaging vocabulary's own consumers.
 */
export type { MessagingChannel } from "@prismshadow/penguin-library-session";
import type { MessagingChannel } from "@prismshadow/penguin-library-session";

/** Event-connection runtime state of one binding (kept in memory, not persisted). */
export type MessagingRuntimeState = "disconnected" | "connecting" | "connected" | "error";

/**
 * A failure that happened AFTER an inbound message was accepted — as opposed to a
 * connection failure, which `MessagingRuntimeStatus.lastError` reports.
 *
 * The two stages fail in completely different places and lead to different actions, and
 * from the chat they are indistinguishable (both produce silence), which is why the stage
 * is stated rather than folded into one message.
 */
export interface MessagingDeliveryError {
  /** ISO 8601 timestamp of the failure. */
  at: string;
  /** `inbound` — the message arrived and its Task never started; `send` — a reply never reached the chat. */
  stage: "inbound" | "send";
  /** The failure's own message, as the channel or the Session reported it. */
  detail: string;
}

export interface MessagingRuntimeStatus {
  state: MessagingRuntimeState;
  /** Failure detail; present only in the `error` state. */
  lastError?: string;
  /** When the state last changed (ISO 8601); absent for a binding that never connected. */
  changedAt?: string;
  /**
   * When this binding last accepted an inbound message (ISO 8601).
   *
   * "Connected, and nothing has arrived" is the answer to the one question a chat cannot
   * answer for itself — whether the platform is delivering anything at all. A channel that
   * withholds messages (Telegram's group privacy, a bot that is not a member) produces
   * exactly that, with no error anywhere.
   *
   * In-process AND scoped to one connection: it starts empty on every (re)connect, and a
   * re-enable or a credential save opens a new one. So an absent field means "nothing since
   * this connection opened", never "nothing ever" — anything reporting it has to say which,
   * or it sends a reader off to fix a channel that is working.
   */
  lastInboundAt?: string;
  /**
   * The most recent post-acceptance failure; absent when none has happened since this
   * connection opened, and never cleared by a later success — an intermittent failure would
   * otherwise be erased by the next ordinary message. `at` is what says how stale it is.
   */
  lastDeliveryError?: MessagingDeliveryError;
  /**
   * The most recent CONNECTION failure, kept after the connection recovers — unlike
   * `lastError`, which belongs to the `error` state and is gone the moment the state leaves it.
   *
   * A connection that fails and recovers repeatedly (a second program polling the same bot
   * token takes turns with this one) reads as `connected` in any snapshot taken between
   * flaps, with nothing at all to show for the failures in between. This is what is left
   * behind — for the life of the connection, like the two above it.
   */
  lastConnectionError?: { at: string; detail: string };
  /**
   * Since when (ISO 8601) the bot has been HOLDING replies it could not deliver yet, to send
   * them with the chat's next inbound message; absent while nothing is held. WeChat only: the
   * platform accepts a bot's messages only for a while after the user's last one, and only
   * about ten per message, so a long run or a quiet user leaves replies waiting rather than
   * lost.
   *
   * Not a failure, and deliberately not `lastDeliveryError`: nothing is broken and nobody has
   * to act beyond what the panel says — message the bot in WeChat and the held replies arrive
   * first. Cleared the moment they have been delivered. Unlike the fields above it is not
   * scoped to one connection: held replies are stored, so a backlog from before a restart is
   * reported again as soon as the connection opens.
   */
  heldReplySince?: string;
}

/**
 * What a messaging binding carries whatever channel it is: the connection intent, the three
 * delivery preferences, whether a chat is known, and the row's identity and timestamps.
 *
 * Split out because this is the half that grows. Three delivery preferences arrived in one
 * release, and each would otherwise have been written into three interfaces — the credential
 * slice is the only thing a channel genuinely differs in, and it is what stays per-channel.
 *
 * `channel` is NOT here: a discriminated union discriminates on a literal the member itself
 * declares, so each interface keeps its own.
 *
 * A channel may RE-DECLARE a field below when it has more to say about it — QQ does, for all
 * three preferences, because the platform's passive-reply budget and its expiring window
 * change what setting one costs there. The re-declared type must be identical, which the
 * compiler enforces, so the redeclaration can only add documentation and never a contract.
 */
export interface MessagingBindingCommon {
  sessionId: string;
  /** Connection INTENT (the state toggle's value); new bindings start disabled, and at most one of a Session's channels is enabled. */
  enabled: boolean;
  /**
   * Send each non-blank line of a relayed assistant reply as its own message instead of one
   * message per reply. Off by default; off is the original one-message-per-reply behaviour.
   */
  linePerMessage: boolean;
  /**
   * Relay only the LAST completed assistant message of a run, delivered when the run ends,
   * instead of mirroring each completed message as it completes. Off by default; off is the
   * original every-message behaviour. Independent of `linePerMessage`, which then applies to
   * that one final message. The approval notice is not a reply and is unaffected.
   */
  finalReplyOnly: boolean;
  /**
   * Render a relayed reply's Markdown in this channel's own markup instead of sending its
   * characters as written. ON by default. Each channel shows what it can — Telegram has no
   * headings, lists or tables, QQ has no code or tables, Feishu has all of them, and WeChat
   * reads Markdown itself so the render is a subtraction rather than a translation — and a
   * rendering the channel refuses falls back to the plain source, so this can cost
   * formatting and never a message.
   */
  renderMarkdown: boolean;
  /**
   * Whether an inbound chat is known (the bot has been messaged at least once). Replies and
   * test messages target that chat; until it exists nothing can be sent.
   */
  lastChatKnown: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The stored Feishu config, secret masked (plaintext never leaves the server). */
export interface FeishuBindingInfo extends MessagingBindingCommon {
  channel: "feishu";
  appId: string;
  /**
   * Masked app secret (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no secret is stored (never entered, or cleared) — the binding cannot be
   * enabled until one is saved.
   */
  appSecretMasked?: string;
  baseDomain: string;
}

/** The stored Telegram config, token masked (plaintext never leaves the server). */
export interface TelegramBindingInfo extends MessagingBindingCommon {
  channel: "telegram";
  /** The numeric bot id (the token's half before the colon) — the channel-scoped account identity, never secret. */
  botId: string;
  /**
   * Masked bot token (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no token is stored (cleared) — the binding cannot be enabled until one
   * is saved.
   */
  botTokenMasked?: string;
}

/**
 * The stored QQ config, secret masked (plaintext never leaves the server).
 *
 * The three preference fields are re-declared unchanged: every one of them costs something
 * different here, and the platform's reply budget is what a reader setting one needs to know.
 */
export interface QQBindingInfo extends MessagingBindingCommon {
  channel: "qq";
  /** The bot's App ID — the channel-scoped account identity, never secret. */
  appId: string;
  /**
   * Masked App Secret (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no secret is stored (never entered, or cleared) — the binding cannot be
   * enabled until one is saved.
   */
  appSecretMasked?: string;
  /**
   * Send each non-blank line of a relayed assistant reply as its own message instead of one
   * message per reply. Off by default. On QQ the split is additionally capped at the
   * platform's passive-reply budget rather than the channel-neutral ceiling, so it yields
   * far fewer messages here than on the other channels.
   */
  linePerMessage: boolean;
  /**
   * Relay only the LAST completed assistant message of a run, delivered when the run ends.
   * Off by default.
   *
   * On QQ it cuts both ways, which is worth knowing before setting it here. It spends the
   * least of the platform's passive-reply budget a run can spend — one message, where an
   * every-message relay spends one per completed message. But a passive reply is accepted
   * only for a few minutes after the inbound message that funds it, and holding the reply
   * to the run's end spends that window on the run: a run that outlives it delivers nothing
   * at all, where the every-message relay would have sent whatever completed inside it.
   */
  finalReplyOnly: boolean;
  /**
   * Render a relayed reply's Markdown in this channel's own markup. ON by default. QQ's own
   * subset is the widest for prose and the narrowest for code: headings, lists, blockquotes
   * and rules render, while inline code, fenced code and tables have no syntax at all here —
   * a code block arrives as plain escaped lines. A rendering the platform refuses falls back
   * to the plain source, at the cost of one more slot from the passive-reply budget.
   */
  renderMarkdown: boolean;
  /**
   * Whether an inbound QQ chat is known (the bot has been messaged at least once). Weaker
   * than it looks on this channel: QQ accepts only replies to a recent message, so a known
   * chat is necessary but not sufficient for anything to be deliverable right now.
   */
  lastChatKnown: boolean;
}

/**
 * The stored WeChat config, token masked (plaintext never leaves the server).
 *
 * No preference field is re-declared. The three delivery preferences cost exactly what they
 * cost on Feishu and Telegram here — this channel has no reply budget and no expiring reply
 * window — and re-declaring a field to say nothing new about it would only invite the next
 * reader to look for the difference.
 */
export interface WeChatBindingInfo extends MessagingBindingCommon {
  channel: "wechat";
  /** The bot id a scan issued — the channel-scoped account identity, never secret. */
  botId: string;
  /**
   * Masked bot token (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when none is stored (cleared, or a scan that never completed) — the binding
   * cannot be enabled until a scan saves one.
   */
  botTokenMasked?: string;
}

/** A Session's saved config for one messaging channel (`channel` is the discriminant). */
export type MessagingBindingInfo =
  FeishuBindingInfo | TelegramBindingInfo | QQBindingInfo | WeChatBindingInfo;

/** One saved channel config with its event-connection runtime status. */
export interface MessagingChannelState {
  binding: MessagingBindingInfo;
  /** Only the enabled channel's connection is ever anything but disconnected. */
  status: MessagingRuntimeStatus;
}

/**
 * GET …/messaging response — the channel-agnostic read the channel-aware binding editor
 * loads: EVERY saved channel config (masked) with its runtime status. A Session may keep
 * both channels saved; at most one of them is enabled.
 */
export interface MessagingBindingsResponse {
  bindings: MessagingChannelState[];
}

/** GET / PUT …/messaging/feishu response: the Feishu config (null = not saved) plus its runtime status. */
export interface FeishuBindingResponse {
  binding: FeishuBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/** GET / PUT …/messaging/telegram response (the Telegram narrowing of the same envelope). */
export interface TelegramBindingResponse {
  binding: TelegramBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/** GET / PUT …/messaging/qq response (the QQ narrowing of the same envelope). */
export interface QQBindingResponse {
  binding: QQBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/** GET / PUT …/messaging/wechat response (the WeChat narrowing of the same envelope). */
export interface WeChatBindingResponse {
  binding: WeChatBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/**
 * PUT …/messaging/feishu — saves credentials/config ONLY, never flipping the connection
 * (exception: an enabled binding's connector restarts with the new credentials so stored
 * config and live connection never diverge). The connection toggle is POST …/state.
 */
/**
 * The delivery preferences any channel's PUT may set. Each is optional and each behaves the
 * same way on every channel: an omitted field keeps the stored value, so a client that knows
 * about one preference can save it without having to send the others back. Their meanings are
 * on {@link MessagingBindingCommon}, and where a channel charges differently for one, on that
 * channel's own `*BindingInfo`.
 *
 * The defaults a binding created without them starts from: `linePerMessage` off,
 * `finalReplyOnly` off, `renderMarkdown` ON.
 */
export interface MessagingDeliveryPatch {
  linePerMessage?: boolean;
  finalReplyOnly?: boolean;
  renderMarkdown?: boolean;
}

export interface FeishuBindingPutRequest extends MessagingDeliveryPatch {
  appId: string;
  /** Omitted or blank keeps the stored secret (the masked value never round-trips). */
  appSecret?: string;
  /** Defaults to https://open.feishu.cn when omitted or blank. */
  baseDomain?: string;
  /**
   * Drops the STORED secret (the models-page clear idiom; a typed `appSecret` wins over
   * it). Refused with 409 `messaging_disable_before_clear` while the binding is enabled.
   */
  clearAppSecret?: boolean;
}

/**
 * PUT …/messaging/telegram — saves the credential ONLY, same contract as the Feishu PUT
 * (an enabled binding's connector restarts with the new token; the connection toggle is
 * POST …/state). Saving never conflicts across Sessions: the same bot may sit saved on
 * several, and only enabling it is exclusive.
 */
export interface TelegramBindingPutRequest extends MessagingDeliveryPatch {
  /** Omitted or blank keeps the stored token (the masked value never round-trips). */
  botToken?: string;
  /**
   * Drops the STORED token (the models-page clear idiom; a typed `botToken` wins over
   * it — and the row keeps its bot identity). Refused with 409
   * `messaging_disable_before_clear` while the binding is enabled.
   */
  clearBotToken?: boolean;
}

/**
 * PUT …/messaging/qq — saves the credential pair ONLY, same contract as the Feishu PUT
 * (an enabled binding's connector restarts with the new credentials; the connection toggle
 * is POST …/state). The App ID is the account identity, so changing it rebinds the row to
 * a different bot and drops the remembered chat.
 */
export interface QQBindingPutRequest extends MessagingDeliveryPatch {
  appId: string;
  /** Omitted or blank keeps the stored secret (the masked value never round-trips). */
  appSecret?: string;
  /**
   * Drops the STORED secret (the models-page clear idiom; a typed `appSecret` wins over
   * it). Refused with 409 `messaging_disable_before_clear` while the binding is enabled.
   */
  clearAppSecret?: boolean;
}

/**
 * PUT …/messaging/wechat — the delivery preferences ONLY.
 *
 * The one PUT on this router that carries no credential, because there is none to carry: a
 * WeChat bot token exists only where a scan put it, and there is no console to copy one out
 * of. Saving therefore presupposes a binding — a PUT before any scan answers 400
 * `wechat_token_required` rather than creating an empty row — and the connection toggle
 * stays POST …/state, as on every channel.
 */
export interface WeChatBindingPutRequest extends MessagingDeliveryPatch {
  /**
   * Drops the STORED token (the models-page clear idiom). Refused with 409
   * `messaging_disable_before_clear` while the binding is enabled. The row and its bot
   * identity stay; only a fresh scan can make it connectable again.
   */
  clearBotToken?: boolean;
}

/**
 * POST …/messaging/<channel>/state — enable connects with the STORED credentials,
 * disable terminates. Enabling is what binds the bot account to this Session, and it is
 * mutually exclusive twice over: while another channel of the same Session is enabled it
 * answers 409 `another_channel_enabled`, and while another SESSION has the same account
 * enabled it answers 409 `account_enabled_elsewhere` (both say: turn that one off first).
 * A config whose secret is missing answers its channel's 400 `*_required`.
 */
export interface MessagingBindingStateRequest {
  enabled: boolean;
}

/** POST …/messaging/feishu/test — draft values; each omitted field falls back to the stored binding. */
export interface FeishuTestRequest {
  appId?: string;
  appSecret?: string;
  baseDomain?: string;
}

/** Credential-test outcome (an unreachable/rejected credential is `ok:false`, not an HTTP error). */
export interface FeishuTestResponse {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** POST …/messaging/telegram/test — a draft token, falling back to the stored binding when omitted. */
export interface TelegramTestRequest {
  botToken?: string;
}

/** Telegram credential-test outcome: success additionally names the bot the token signs in as. */
export interface TelegramTestResponse {
  ok: boolean;
  latencyMs?: number;
  /** The bot's `@username`, when the API reports one. */
  botUsername?: string;
  /**
   * True when @BotFather's **Group Privacy** is ON for this bot, which is the default. In
   * every group where the bot is not an administrator it then receives only a command
   * addressed to it or a reply to one of its own messages — an ordinary sentence is never
   * delivered, so a binding that answers fine in a direct chat stays silent there. The
   * setting is account-wide and Telegram overrides it for a group the bot administers, so
   * this reports the setting and never the outcome in any particular group. Absent when the
   * API did not report the setting; never inferred.
   */
  groupPrivacy?: boolean;
  error?: string;
}

/** POST …/messaging/qq/test — draft values; each omitted field falls back to the stored binding. */
export interface QQTestRequest {
  appId?: string;
  appSecret?: string;
}

/**
 * QQ credential-test outcome. There is no account label: the platform's only credential
 * call is the access-token exchange, which identifies nothing beyond the App ID that was
 * sent to it.
 */
export interface QQTestResponse {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * POST …/messaging/qq/scan — starts a scan-to-connect flow: the server registers a bind
 * task under a fresh AES key it keeps to itself, and answers with what the browser may
 * know. The key is absent from this type on purpose — it decrypts the App Secret, so it
 * never leaves the server (the same rule that keeps a stored secret from round-tripping).
 */
export interface QQScanStartResponse {
  /** Opaque bind-task handle, passed back to the poll endpoint. */
  taskId: string;
  /** The URL to ENCODE into a QR code. It is opened by the QQ app, never fetched by the browser. */
  qrUrl: string;
  /** How often to poll, in milliseconds (the interval the protocol is designed around). */
  pollMs: number;
}

/**
 * POST …/messaging/qq/scan/poll — one step of the scan. `pending` means keep polling,
 * `expired` means start a new task and show a new QR, and `completed` means the server has
 * already decrypted the App Secret and SAVED the binding: `appId` names the bot that landed.
 * Saving is all it does — enabling the connection stays the separate, exclusive act it is on
 * every channel. A task id that is unknown, belongs to another Session, was already
 * resolved, or is being resolved by a poll still in flight answers 404
 * `qq_scan_task_unknown`: the task is claimed by one poll, so a client whose interval fires
 * before the previous request came back binds once rather than once per overlapping poll.
 */
export interface QQScanPollResponse {
  status: "none" | "pending" | "completed" | "expired";
  /** The bound bot's App ID; present only on `completed`. Never the secret. */
  appId?: string;
  /** The saved binding, present on `completed` so the editor refreshes without a second GET. */
  binding?: QQBindingInfo;
}

/**
 * WeChat credential-test outcome. There is no request body and no draft to probe: this
 * channel's credential exists only where a scan put it, so the test always probes the STORED
 * binding. It answers 400 `wechat_token_required` when there is none.
 *
 * No account label, for the same reason QQ has none: the probe (`getconfig`) reports the
 * bot's settings and names neither the bot nor the person.
 */
export interface WeChatTestResponse {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * POST …/messaging/wechat/scan — starts a scan-to-connect flow, which on this channel is the
 * ONLY way to bind: the bot token has no console to be copied out of.
 *
 * The server registers a code and answers with what the browser may know. The platform's own
 * poll handle is absent from this type on purpose — it is what collects the bot token, so it
 * never leaves the server, and `taskId` is a handle this server mints in its place.
 */
export interface WeChatScanStartResponse {
  /** Opaque scan handle, passed back to the poll, verify and cancel endpoints. */
  taskId: string;
  /** The URL to ENCODE into a QR code. It is opened by WeChat, never fetched by the browser. */
  qrUrl: string;
  /** How often to poll, in milliseconds. */
  pollMs: number;
}

/**
 * Where a WeChat scan stands. Richer than QQ's four states because the flow is: WeChat
 * separates scanning from confirming, and may interpose a pairing code shown on the phone.
 *
 * - `pending` — the code is up and nothing has happened; keep polling.
 * - `scanned` — scanned; the phone is showing the confirmation prompt.
 * - `need_verify_code` — the phone is showing digits that must be sent to the verify
 *   endpoint before the bind proceeds.
 * - `blocked` — too many wrong pairing codes; the code is spent and a new scan is needed.
 * - `expired` — the code lapsed before it was used; show a new one.
 * - `already_bound` — this bot is already bound to this server, so no new credentials were
 *   issued and nothing was saved. Not a failure: the existing binding still works.
 * - `completed` — the server has already SAVED the binding; `botId` names the bot.
 */
export type WeChatScanStatus =
  | "pending"
  | "scanned"
  | "need_verify_code"
  | "blocked"
  | "expired"
  | "already_bound"
  | "completed";

/**
 * POST …/messaging/wechat/scan/poll — one step of the scan.
 *
 * `completed` means the server has decrypted nothing and stored everything: the credentials
 * went from the platform into storage without passing through the browser. Saving is all it
 * does — enabling the connection stays the separate, exclusive act it is on every channel. A
 * task id that is unknown, belongs to another Session, or was already resolved answers 404
 * `wechat_scan_task_unknown`.
 *
 * Unlike QQ's poll, an overlapping request answers `pending` rather than 404: the upstream
 * call is a LONG poll, so one of them spans several of the client's intervals, and that
 * overlap is the normal rhythm rather than a replay.
 */
export interface WeChatScanPollResponse {
  status: WeChatScanStatus;
  /** The bound bot's id; present only on `completed`. Never the token. */
  botId?: string;
  /** The saved binding, present on `completed` so the editor refreshes without a second GET. */
  binding?: WeChatBindingInfo;
}

/**
 * POST …/messaging/wechat/scan/verify — the digits WeChat showed on the phone.
 *
 * They ride the NEXT poll rather than a request of their own, because the platform takes the
 * pairing code as a parameter of the status call: this endpoint records them and answers
 * 204. A wrong code is not reported here — the next poll asks for one again, which is how
 * the platform reports it.
 */
export interface WeChatScanVerifyRequest {
  taskId: string;
  verifyCode: string;
}

/**
 * POST …/messaging/<channel>/test-message — sent to the last known chat (409
 * `feishu_no_chat` / `telegram_no_chat` / `qq_no_chat` before one exists). On QQ this can
 * still fail with 502 afterwards: the platform accepts only replies to a message sent from
 * QQ minutes earlier, so a known chat does not mean a deliverable one.
 */
export interface MessagingTestMessageResponse {
  ok: true;
}

/**
 * One bot account a server has enabled: the channel and its account id (Feishu `app_id`,
 * Telegram bot id, QQ App ID, WeChat bot id), which is public by design. Never a Session,
 * never a secret.
 */
export interface MessagingAccount {
  channel: MessagingChannel;
  accountId: string;
}

/**
 * GET /api/messaging/accounts (admin only) — every bot account this server has enabled,
 * across all its Projects. A server that connects machines asks each of them this when a
 * bot is about to be turned on, so that one account is enabled on one server at a time.
 */
export interface MessagingAccountsResponse {
  accounts: MessagingAccount[];
}

/** A server that has the asked-about bot enabled: a machine by id and alias, or this server (both null). */
export interface MessagingAccountHolder {
  machineId: string | null;
  alias: string | null;
}

/**
 * Why a machine could not be asked: no connection to it, a build without the accounts
 * route (it answered 404), or any other failed answer.
 */
export type MessagingUnreachableReason = "not_connected" | "older_build" | "failed";

/** A machine of the Project that could not be asked whether it holds the bot. */
export interface MessagingUnreachableMachine {
  machineId: string;
  alias: string;
  reason: MessagingUnreachableReason;
}

/**
 * GET /api/projects/:projectId/messaging/account-holders?channel=&accountId= — which servers
 * have this bot enabled: this server, and each machine the Project uses that could be asked.
 * Machines that could not be asked are listed apart; the caller decides what to do about
 * them. Never names a Session. A caller who is not an admin is answered for this server
 * only, because machines are admins' (both lists then hold no machine).
 */
export interface MessagingAccountHoldersResponse {
  holders: MessagingAccountHolder[];
  unreachable: MessagingUnreachableMachine[];
}
