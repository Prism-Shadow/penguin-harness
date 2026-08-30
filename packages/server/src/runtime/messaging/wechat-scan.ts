import { Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
/**
 * WeChat scan-to-connect: binding the official claw bot by scanning a QR code in WeChat.
 *
 * Unlike QQ, this is not the convenient alternative to typing credentials — it is the ONLY
 * way to obtain them. The bot token this flow issues exists nowhere a person can copy it
 * from: there is no developer console for this channel and no pair of fields to fall back
 * to, so the editor offers a scan and nothing else.
 *
 * The protocol is two calls against `ilinkai.weixin.qq.com`:
 *
 *   1. `get_bot_qrcode` returns a `qrcode` handle and a URL. The URL is ENCODED INTO A QR
 *      CODE and never fetched by this server — WeChat resolves it when the code is scanned.
 *   2. `get_qrcode_status` is LONG-POLLED with the handle until it reports the scan
 *      confirmed, at which point it returns the bot token, the bot id, the id of the person
 *      who scanned, and the API host this bot is to be polled against.
 *
 * ## The `qrcode` handle is the whole security model
 *
 * There is no encrypted payload here as there is on QQ, and so no key to protect: the
 * handle IS the thing that turns into a bot token, and anyone holding it can poll the token
 * out. It is therefore generated here, held here, used here, and dropped here — the browser
 * is given a task id this module mints instead, plus the URL and a status. The QR's URL is
 * safe to render because scanning it authorizes nothing on its own; only the paired handle
 * can collect the result.
 *
 * ## Why the poll is shaped differently from QQ's
 *
 * `get_qrcode_status` is a LONG poll: the platform holds it open until the state changes.
 * That gives the browser its state changes within a second of them happening, but it also
 * means one upstream call outlives several of the browser's polling intervals. QQ answers an
 * overlapping poll with a 404 because there a second poll could bind a second time; here it
 * answers `pending`, because the overlap is the normal case rather than a replay. The
 * once-only guarantee is unchanged and comes from the same place it does on QQ: a resolved
 * task is deleted, so nothing can resolve it twice.
 */
import { randomBytes } from "node:crypto";
import { WECHAT_API_BASE, WECHAT_BOT_TYPE, wechatFetchErrorText } from "./wechat-api.js";

/** Overall deadline for `get_bot_qrcode`, which answers immediately. */
const CREATE_TIMEOUT_MS = 15_000;

/**
 * How long ONE upstream status poll may be held. The platform's own window is 35s; this is
 * shorter so the browser's request — which is parked on it — returns promptly and its own
 * interval keeps a steady rhythm. A window that closes with nothing to report is `pending`,
 * exactly as the protocol intends.
 */
const POLL_TIMEOUT_MS = 8_000;

/** How often the browser should poll (see the module doc on why overlaps are expected). */
export const WECHAT_SCAN_POLL_MS = 2000;

/**
 * Where the scan stands, in the vocabulary the browser renders.
 *
 * Richer than QQ's four states because the flow is: WeChat separates SCANNING from
 * confirming, and may interpose a pairing code shown on the phone that the person types
 * here. Each state below is one the user has to be told something different about.
 */
export type WeChatScanStatus =
  /** The code is on screen and nothing has happened yet. */
  | "pending"
  /** Scanned; the phone is showing the confirmation prompt. */
  | "scanned"
  /** The phone is showing digits that must be typed here before the bind proceeds. */
  | "need_verify_code"
  /** Too many wrong pairing codes: the platform has stopped accepting them for now. */
  | "blocked"
  /** The code lapsed before it was used; a new one is needed. */
  | "expired"
  /** This bot is already bound to this server, so no new credentials were issued. */
  | "already_bound"
  | "completed";

/** The credentials a confirmed scan produced. */
export interface WeChatScanResult {
  botId: string;
  botToken: string;
  /** The API host this bot is assigned; the platform's default host when it named none. */
  baseUrl: string;
  /** The person who scanned — what the credential probe is made on behalf of. */
  userId: string;
}

/** One upstream poll's outcome, normalized. */
export interface WeChatScanPollResult {
  status: WeChatScanStatus;
  /** Present only on `completed`. */
  bot?: WeChatScanResult;
  /**
   * A host the platform redirected polling to. Internal: the caller switches to it and keeps
   * polling, and the browser only ever sees the status that rode along with it.
   */
  redirectHost?: string;
}

/** The two calls, behind a seam so tests substitute a fake and never open a socket. */
export interface WeChatScanTransport {
  /** Registers a code; resolves the poll handle and the URL to encode into the QR. */
  createQrCode(): Promise<{ qrcode: string; qrUrl: string }>;
  /**
   * One long poll of a code's status. `verifyCode` carries the digits the person read off
   * their phone, when the previous poll asked for them.
   */
  pollQrStatus(args: {
    baseUrl: string;
    qrcode: string;
    verifyCode?: string;
  }): Promise<WeChatScanPollResult>;
}

/** The status strings the wire uses, mapped onto the ones above. */
function statusOf(raw: unknown): WeChatScanStatus {
  switch (raw) {
    case "confirmed":
      return "completed";
    case "scaned":
    // A redirect is a scan that must continue against another host: the person has scanned,
    // which is what they need told, and the host switch is the caller's business.
    case "scaned_but_redirect":
      return "scanned";
    case "need_verifycode":
      return "need_verify_code";
    case "verify_code_blocked":
      return "blocked";
    case "expired":
      return "expired";
    case "binded_redirect":
      return "already_bound";
    default:
      // An unknown value reads as "keep waiting" rather than as a failure: a state this
      // build has not heard of is not a reason to take a live code off the user's screen.
      return "pending";
  }
}

/** The production factory: plain HTTPS against the platform's fixed entry host. */
export function createWeChatScanTransport(base = WECHAT_API_BASE): WeChatScanTransport {
  /**
   * The headers these two calls take. There is no `Authorization` on either — they are what
   * ISSUES the token, so there is none to send.
   */
  const headers = (): Record<string, string> => ({
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String((1 << 16) | 0),
  });

  return {
    async createQrCode(): Promise<{ qrcode: string; qrUrl: string }> {
      let res: Response;
      try {
        res = await fetch(
          `${base}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WECHAT_BOT_TYPE)}`,
          {
            method: "POST",
            headers: { ...headers(), "content-type": "application/json" },
            // The platform takes the tokens this client already holds so it can recognize a
            // rebind of a bot it has already issued one for. Nothing here offers them: a
            // stored token is another Session's credential, and the `already_bound` answer
            // this would enable is not worth handing one binding's secret to another's flow.
            body: JSON.stringify({ local_token_list: [] }),
            signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
          },
        );
      } catch (err) {
        throw new Error(`WeChat scan request failed: ${wechatFetchErrorText(err)}`);
      }
      if (!res.ok) throw new Error(`WeChat scan request failed: HTTP ${res.status}`);
      const body = (await res.json().catch(() => null)) as {
        qrcode?: string;
        qrcode_img_content?: string;
      } | null;
      const qrcode = body?.qrcode;
      const qrUrl = body?.qrcode_img_content;
      if (
        typeof qrcode !== "string" ||
        qrcode === "" ||
        typeof qrUrl !== "string" ||
        qrUrl === ""
      ) {
        throw new Error("WeChat scan request failed: no QR code was returned");
      }
      return { qrcode, qrUrl };
    },

    async pollQrStatus({ baseUrl, qrcode, verifyCode }): Promise<WeChatScanPollResult> {
      const query = new URLSearchParams({ qrcode });
      if (verifyCode !== undefined && verifyCode !== "") query.set("verify_code", verifyCode);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/ilink/bot/get_qrcode_status?${query.toString()}`, {
          headers: headers(),
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
      } catch (err) {
        // A long poll that closed with nothing to say is indistinguishable from one this
        // client timed out, and both mean the same thing: nothing changed, ask again. A
        // gateway's own timeout (a 504 from an edge that got bored) lands here too.
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          return { status: "pending" };
        }
        throw new Error(`WeChat scan request failed: ${wechatFetchErrorText(err)}`);
      }
      if (!res.ok) throw new Error(`WeChat scan request failed: HTTP ${res.status}`);
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        bot_token?: string;
        ilink_bot_id?: string;
        ilink_user_id?: string;
        baseurl?: string;
        redirect_host?: string;
      } | null;
      const status = statusOf(body?.status);
      const redirect =
        typeof body?.redirect_host === "string" && body.redirect_host !== ""
          ? { redirectHost: body.redirect_host }
          : {};
      if (status !== "completed") return { status, ...redirect };
      const botId = body?.ilink_bot_id;
      const botToken = body?.bot_token;
      if (
        typeof botId !== "string" ||
        botId === "" ||
        typeof botToken !== "string" ||
        botToken === ""
      ) {
        throw new Error("WeChat reported the scan confirmed but returned no credentials");
      }
      return {
        status: "completed",
        bot: {
          botId,
          botToken,
          baseUrl:
            typeof body?.baseurl === "string" && body.baseurl !== ""
              ? body.baseurl
              : WECHAT_API_BASE,
          userId: typeof body?.ilink_user_id === "string" ? body.ilink_user_id : "",
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The in-flight task table
// ---------------------------------------------------------------------------

/**
 * How long a code is kept. The platform expires codes on its own and reports it, so this is
 * only the bound on remembering a handle for a flow nobody finished — a browser tab closed
 * mid-scan leaves a task that will otherwise never be polled again.
 */
export const WECHAT_SCAN_TASK_TTL_MS = 10 * 60_000;

/**
 * How many codes ONE Session may keep in flight. Per-Session rather than process-wide for
 * the reason qq-scan.ts is: starting a scan is reachable by anyone who owns a Project, so a
 * table bounded only across all callers lets one of them in a loop evict everybody else's
 * code. Eviction here can only ever drop the caller's OWN oldest task.
 */
const WECHAT_SCAN_MAX_TASKS_PER_SESSION = 4;

/** Absolute bound across every Session — a memory backstop, far above any real concurrency. */
const WECHAT_SCAN_MAX_TASKS = 4096;

/** One in-flight scan. `qrcode` is the reason this table exists at all (see the module doc). */
interface WeChatScanTask {
  /** The platform's poll handle. NEVER leaves this process. */
  qrcode: string;
  /** The Session that started the scan; another Session's poll is not this task's business. */
  sessionId: string;
  createdAt: number;
  /** An upstream poll is in flight; a second one would only wait behind it. */
  polling: boolean;
  /** The host polling has been redirected to, once the platform names one. */
  baseUrl: string;
  /**
   * The digits the person typed, held until the next poll carries them. Kept rather than
   * sent immediately because the poll that asks for them is the one that has just returned:
   * there is no request in flight to put them on.
   */
  verifyCode?: string;
}

/** What a poll tells the caller: where the scan stands, and the credentials once it landed. */
export interface WeChatScanPoll {
  status: WeChatScanStatus;
  /** Present only on `completed` — for the caller to store. */
  bot?: WeChatScanResult;
}

export interface WeChatScanServiceOpts {
  now?: () => number;
}

/**
 * Holds the in-flight codes and their poll handles.
 *
 * Deliberately in memory, for the reason QQScanService is: a task is alive for the couple of
 * minutes a person spends scanning, and persisting a handle that collects a bot token would
 * buy nothing except a second place for it to leak from. A server restart mid-scan loses the
 * task and the user starts another, which is a strictly better failure than a handle at rest.
 */
export class WeChatScanService {
  private readonly tasks = new Map<string, WeChatScanTask>();
  private readonly now: () => number;
  /** The self-re-arming sweep, alive only while a task is remembered (see `armSweep`). */
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly transport: WeChatScanTransport,
    opts: WeChatScanServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Starts a scan: a fresh code, a task registered under a handle of this module's own. */
  async start(sessionId: string): Promise<{ taskId: string; qrUrl: string; pollMs: number }> {
    this.sweep();
    const { qrcode, qrUrl } = await this.transport.createQrCode();
    // Evicted after the create rather than before it: a create that failed must not have
    // cost the caller a live code.
    this.evictOwn(sessionId);
    // The task id is minted here rather than being the platform's `qrcode`, which is the
    // whole point: the browser polls with a handle that collects nothing on its own.
    const taskId = randomBytes(16).toString("hex");
    this.tasks.set(taskId, {
      qrcode,
      sessionId,
      createdAt: this.now(),
      polling: false,
      baseUrl: WECHAT_API_BASE,
    });
    this.armSweep();
    return { taskId, qrUrl, pollMs: WECHAT_SCAN_POLL_MS };
  }

  /**
   * Records the pairing code the person read off their phone. It rides the NEXT poll rather
   * than a request of its own: the platform takes it as a parameter of the status call, and
   * there is no separate submit.
   *
   * Returns false for a task this Session did not start, which the caller answers with the
   * same 404 an unknown poll gets.
   */
  submitVerifyCode(sessionId: string, taskId: string, verifyCode: string): boolean {
    const task = this.tasks.get(taskId);
    if (task === undefined || task.sessionId !== sessionId) return false;
    task.verifyCode = verifyCode;
    return true;
  }

  /**
   * Polls one task. Returns null when the task id is not one this Session started — an
   * unknown id, another Session's, or one already resolved — which the caller answers 404,
   * and which is also what a replay gets.
   */
  async poll(sessionId: string, taskId: string): Promise<WeChatScanPoll | null> {
    const task = this.tasks.get(taskId);
    if (task === undefined || task.sessionId !== sessionId) return null;
    if (this.now() - task.createdAt > WECHAT_SCAN_TASK_TTL_MS) {
      this.tasks.delete(taskId);
      return { status: "expired" };
    }
    // An upstream poll is long, so the browser's interval fires several times inside one.
    // Those overlaps are the normal rhythm here rather than a replay to refuse: they answer
    // "nothing yet" and the one real call keeps running (see the module doc).
    if (task.polling) return { status: "pending" };
    task.polling = true;
    let result: WeChatScanPollResult;
    try {
      result = await this.transport.pollQrStatus({
        baseUrl: task.baseUrl,
        qrcode: task.qrcode,
        ...(task.verifyCode !== undefined ? { verifyCode: task.verifyCode } : {}),
      });
    } catch (err) {
      // A request that failed resolved nothing: the task stays pollable, which is what lets
      // the client ride out a transient platform error without dropping the user's code.
      task.polling = false;
      throw err;
    } finally {
      // The task may already be gone by here (a cancel landed mid-poll); writing to the
      // object it held is harmless, and the map no longer points at it.
      task.polling = false;
    }
    // The platform hands polling to another host mid-flow. It is not a state of its own for
    // the browser — the scan is simply still in progress — so the switch is made here and
    // the status that rode along with it is what is reported.
    if (result.redirectHost !== undefined) task.baseUrl = `https://${result.redirectHost}`;
    if (result.status === "scanned" && task.verifyCode !== undefined) {
      // A pairing code the platform accepted takes the flow past `need_verify_code`. Holding
      // it would resubmit it on every later poll, and a stale one would be rejected as wrong.
      task.verifyCode = undefined;
    }
    if (
      result.status === "expired" ||
      result.status === "blocked" ||
      result.status === "already_bound"
    ) {
      // All three are ends: nothing further can come of this code. `blocked` and
      // `already_bound` are the platform declining rather than a lapse, and neither is
      // recoverable by polling the same handle again.
      this.tasks.delete(taskId);
      return { status: result.status };
    }
    if (result.status !== "completed") return { status: result.status };
    // Past here the task is spent whatever happens.
    this.tasks.delete(taskId);
    if (result.bot === undefined) {
      throw new Error("WeChat reported the scan confirmed but returned no credentials");
    }
    return { status: "completed", bot: result.bot };
  }

  /** Drops a task the user walked away from (the editor's cancel, and its unmount). */
  cancel(sessionId: string, taskId: string): void {
    if (this.tasks.get(taskId)?.sessionId === sessionId) this.tasks.delete(taskId);
  }

  /** Session-delete cascade and bind removal: forget anything this Session had in flight. */
  cancelSession(sessionId: string): void {
    for (const [taskId, task] of this.tasks) {
      if (task.sessionId === sessionId) this.tasks.delete(taskId);
    }
  }

  /** Drops this Session's oldest tasks until one more fits under its own ceiling. */
  private evictOwn(sessionId: string): void {
    const own = [...this.tasks].filter(([, task]) => task.sessionId === sessionId);
    if (own.length < WECHAT_SCAN_MAX_TASKS_PER_SESSION) return;
    own.sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [taskId] of own.slice(0, own.length - WECHAT_SCAN_MAX_TASKS_PER_SESSION + 1)) {
      this.tasks.delete(taskId);
    }
  }

  /** Drops expired tasks, then the oldest ones if the table is still over its backstop. */
  private sweep(): void {
    const cutoff = this.now() - WECHAT_SCAN_TASK_TTL_MS;
    for (const [taskId, task] of this.tasks) {
      if (task.createdAt <= cutoff) this.tasks.delete(taskId);
    }
    if (this.tasks.size < WECHAT_SCAN_MAX_TASKS) return;
    const byAge = [...this.tasks].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [taskId] of byAge.slice(0, this.tasks.size - WECHAT_SCAN_MAX_TASKS + 1)) {
      this.tasks.delete(taskId);
    }
  }

  /**
   * Keeps one unref'd timer alive while any task is remembered, so a scan the user walked
   * away from stops holding its handle roughly at the TTL instead of at whenever somebody
   * happens to start the next scan — which may be never.
   */
  private armSweep(): void {
    if (this.sweepTimer !== null || this.tasks.size === 0) return;
    const timer = setTimeout(() => {
      this.sweepTimer = null;
      this.sweep();
      this.armSweep();
    }, WECHAT_SCAN_TASK_TTL_MS);
    timer.unref();
    this.sweepTimer = timer;
  }
}

/** The scan-to-connect transport as a node, so a test stands in a fake for the network. */
export abstract class WeChatScanTransportHandle extends Interface<{
  transport: Opaque<"WeChatScanTransport", WeChatScanTransport>;
}>() {}
@Module()
export class WeChatScanTransportProvider {
  @Provide() wechatScanTransport!: WeChatScanTransportHandle;
  setup() {
    this.wechatScanTransport = { transport: createWeChatScanTransport() };
  }
}
