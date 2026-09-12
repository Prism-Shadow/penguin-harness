/**
 * QQ scan-to-connect: binding a bot by scanning a QR code in the QQ app instead of copying
 * an App ID and an App Secret out of the developer console by hand.
 *
 * The protocol is three calls against `q.qq.com`, and it is not part of the bot OpenAPI —
 * different host, different envelope (`{retcode, msg, data}` rather than
 * `{err_code, message}`), no access token. That is why it lives beside qq-api.ts rather
 * than inside it.
 *
 *   1. `create_bind_task` is handed a fresh 32-byte AES key and returns a `task_id`.
 *   2. The `task_id` goes into a URL which is ENCODED INTO A QR CODE and never fetched.
 *      Scanning it in QQ opens the authorization page for the bots the account owns.
 *   3. `poll_bind_result` is polled every couple of seconds until it reports the scan
 *      completed, at which point it returns the bot's App ID and its App Secret encrypted
 *      under the key from step 1.
 *
 * ## The key is the whole security model
 *
 * The AES key decrypts an App Secret, so it is exactly as sensitive as the secret itself.
 * It is generated here, held here, used here, and dropped here — it is never returned by
 * any route, never rendered, and never reaches a browser. What the browser learns is the
 * QR URL, a status, and (once bound) the App ID, which is not secret. This is the same
 * never-round-trip-the-secret rule the PUT handlers follow, applied to a flow where the
 * secret arrives from outside rather than from the user.
 *
 * Tencent publishes an npm package that implements this (`@tencent-connect/qqbot-connector`).
 * It is deliberately not used: it is `UNLICENSED` with no license text, its dist is
 * machine-obfuscated, and it depends on a terminal QR renderer — three separate reasons a
 * product that distributes its server and maintains THIRD-PARTY-NOTICES.md cannot take it.
 * The protocol is fifty lines and is reimplemented here, behind an injectable seam, in the
 * style of telegram-api.ts.
 */
import { createDecipheriv, randomBytes } from "node:crypto";
import { Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";

/** Host serving the three bind-task calls (not the bot OpenAPI host). */
export const QQ_SCAN_BASE = "https://q.qq.com";

/**
 * The page a scanned QR opens. It always points at the production host, even when the calls
 * above are made against the test one — the QQ app resolves it, not this server.
 */
export const QQ_SCAN_QR_PAGE = "https://q.qq.com/qqbot/openclaw/connect.html";

/** Overall per-request deadline for the three calls. */
const CALL_TIMEOUT_MS = 15_000;

/** How often a client should poll (the interval the protocol is designed around). */
export const QQ_SCAN_POLL_MS = 2000;

/** AES-256 key length, and what `create_bind_task` is handed (base64) as `key`. */
const QQ_SCAN_KEY_BYTES = 32;

/** AES-GCM framing of `bot_encrypt_secret`: a 12-byte IV in front, a 16-byte tag at the end. */
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Where the scan stands, in the protocol's own vocabulary (0 NONE, 1 PENDING, 2 COMPLETED, 3 EXPIRED). */
export type QQBindStatus = "none" | "pending" | "completed" | "expired";

/** One bot a completed scan authorized: its App ID, and its App Secret still encrypted. */
export interface QQBoundBot {
  appId: string;
  /** Base64 AES-256-GCM ciphertext of the App Secret, under the task's key. */
  encryptedSecret: string;
  userOpenid?: string;
}

export interface QQBindPollResult {
  status: QQBindStatus;
  /**
   * The bots a completed scan returned. The wire hands back ONE bot as a bare object; this
   * is a list because the shape is worth normalizing once and because Tencent's own client
   * wraps it in an array, which is where a future multi-bot response would appear.
   */
  bots: QQBoundBot[];
}

/** The three calls, behind a seam so tests substitute a fake and never open a socket. */
export interface QQScanTransport {
  /** Registers a bind task under a base64 AES key; resolves the task id. */
  createBindTask(key: string): Promise<string>;
  pollBindResult(taskId: string): Promise<QQBindPollResult>;
}

/** `{retcode, msg, data}` — the envelope all three calls share (0 = success). */
interface QQScanEnvelope<T> {
  retcode?: number;
  msg?: string;
  data?: T;
}

/** Readable failure text out of fetch's throw shapes (nothing here may echo a request body: it carries the key). */
function fetchErrorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== "") return cause.message;
    return err.message;
  }
  return String(err);
}

/** The protocol's numeric status, widened to a name (an unknown value reads as pending, not as failure). */
function statusOf(raw: unknown): QQBindStatus {
  switch (Number(raw)) {
    case 0:
      return "none";
    case 2:
      return "completed";
    case 3:
      return "expired";
    default:
      return "pending";
  }
}

/** One `data` entry of a completed poll, in the wire's own field names. */
interface QQBindResultData {
  status?: number | string;
  bot_appid?: number | string;
  bot_encrypt_secret?: string;
  user_openid?: string;
}

/** Normalizes the completed payload, which arrives as one object (and is tolerated as a list). */
function botsOf(data: QQBindResultData | QQBindResultData[] | undefined): QQBoundBot[] {
  const entries = data === undefined ? [] : Array.isArray(data) ? data : [data];
  const bots: QQBoundBot[] = [];
  for (const entry of entries) {
    const appId = entry.bot_appid;
    const secret = entry.bot_encrypt_secret;
    if (appId === undefined || appId === "" || typeof secret !== "string" || secret === "") {
      continue;
    }
    bots.push({
      appId: String(appId),
      encryptedSecret: secret,
      ...(typeof entry.user_openid === "string" ? { userOpenid: entry.user_openid } : {}),
    });
  }
  return bots;
}

/** The production factory: plain HTTPS against q.qq.com. */
export function createQQScanTransport(base = QQ_SCAN_BASE): QQScanTransport {
  const post = async <T>(path: string, payload: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`QQ scan request failed: ${fetchErrorText(err)}`);
    }
    const body = (await res.json().catch(() => null)) as QQScanEnvelope<T> | null;
    if (body === null || (body.retcode !== undefined && body.retcode !== 0)) {
      const detail = body?.msg ?? `HTTP ${res.status}`;
      const code = body?.retcode !== undefined ? ` (retcode ${body.retcode})` : "";
      throw new Error(`QQ scan request failed: ${detail}${code}`);
    }
    return body.data as T;
  };

  return {
    async createBindTask(key: string): Promise<string> {
      const data = await post<{ task_id?: string }>("/lite/create_bind_task", { key });
      const taskId = data?.task_id;
      if (typeof taskId !== "string" || taskId === "") {
        throw new Error("QQ scan request failed: no task id was returned");
      }
      return taskId;
    },
    async pollBindResult(taskId: string): Promise<QQBindPollResult> {
      const data = await post<QQBindResultData | QQBindResultData[]>("/lite/poll_bind_result", {
        task_id: taskId,
      });
      const first = Array.isArray(data) ? data[0] : data;
      return { status: statusOf(first?.status), bots: botsOf(data) };
    },
  };
}

/** A fresh base64 AES-256 key for one bind task. */
export function newQQScanKey(): string {
  return randomBytes(QQ_SCAN_KEY_BYTES).toString("base64");
}

/**
 * The URL a QR code encodes. It is never fetched by this server — the QQ app opens it, and
 * `_wv=2` is the in-app webview flag that makes it render as a full-screen page there.
 *
 * `source` is left blank, which is what Tencent's own client sends by default; the
 * authorization page then labels the requester generically. The field's accepted values are
 * not documented, and inventing one risks a page that refuses to load.
 */
export function qqScanQrUrl(taskId: string, source = ""): string {
  return `${QQ_SCAN_QR_PAGE}?task_id=${encodeURIComponent(taskId)}&source=${encodeURIComponent(source)}&_wv=2`;
}

/**
 * Decrypts `bot_encrypt_secret` into the App Secret.
 *
 * The framing is not self-describing, so it is stated here rather than inferred at the call
 * site: base64-decode, then the first 12 bytes are the GCM IV, the LAST 16 are the auth
 * tag, and everything between them is the ciphertext. The key is the base64 `key` from
 * `create_bind_task`, decoded — used raw, with no derivation step.
 *
 * A wrong key, a corrupted payload or a truncated one all fail here as an authentication
 * error rather than as plausible-looking garbage, which is the property that makes storing
 * the result safe without a second check.
 */
export function decryptQQBotSecret(keyBase64: string, encryptedBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const payload = Buffer.from(encryptedBase64, "base64");
  if (key.length !== QQ_SCAN_KEY_BYTES) {
    throw new Error("QQ scan key is not a 32-byte AES key");
  }
  if (payload.length <= GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error("QQ scan payload is too short to contain an encrypted secret");
  }
  const iv = payload.subarray(0, GCM_IV_BYTES);
  const tag = payload.subarray(payload.length - GCM_TAG_BYTES);
  const ciphertext = payload.subarray(GCM_IV_BYTES, payload.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // The cause is never echoed: it is a crypto failure on a payload derived from a secret.
    throw new Error("QQ scan result could not be decrypted");
  }
  const secret = plaintext.toString("utf8");
  if (secret === "") throw new Error("QQ scan result decrypted to an empty secret");
  return secret;
}

// ---------------------------------------------------------------------------
// The in-flight task table
// ---------------------------------------------------------------------------

/**
 * How long a bind task is kept. The platform expires tasks on its own and reports it, so
 * this is only the bound on remembering a key for a flow nobody finished — a browser tab
 * closed mid-scan leaves a task that will otherwise never be polled again.
 */
export const QQ_SCAN_TASK_TTL_MS = 10 * 60_000;

/**
 * How many bind tasks ONE Session may keep in flight. This is the ceiling that binds, and
 * it is per-Session rather than process-wide on purpose: starting a scan is reachable by
 * anyone who owns a Project, which is every signed-up user, so a table bounded only across
 * all callers lets one of them in a loop evict everybody else's code. Eviction here can
 * only ever drop the caller's OWN oldest task. Four covers a person with a couple of tabs
 * open who reloads a few times.
 */
const QQ_SCAN_MAX_TASKS_PER_SESSION = 4;

/**
 * Absolute bound on remembered tasks across every Session — a memory backstop, not the
 * ceiling a caller runs into. It sits far above any real deployment's concurrent scans
 * precisely because reaching it evicts across tenants, which the per-Session ceiling exists
 * to keep from happening.
 */
const QQ_SCAN_MAX_TASKS = 4096;

/** One in-flight bind task. The key is the reason this table exists at all. */
interface QQScanTask {
  /** Base64 AES key. NEVER leaves this process (see the module doc). */
  key: string;
  /** The Session that started the scan; another Session's poll is not this task's business. */
  sessionId: string;
  createdAt: number;
  /** A poll is in flight and holds the right to resolve this task (see `poll`). */
  claimed: boolean;
}

/** What a poll tells the caller: where the scan stands, and the credentials once it landed. */
export interface QQScanPoll {
  status: QQBindStatus;
  /** Present only on `completed` — the plaintext pair, for the caller to store. */
  bot?: { appId: string; appSecret: string };
}

export interface QQScanServiceOpts {
  now?: () => number;
}

/**
 * Holds the in-flight bind tasks and their keys.
 *
 * Deliberately in memory: a task is alive for the couple of minutes a person spends
 * scanning, and persisting an AES key that decrypts an App Secret would buy nothing except
 * a second place for it to leak from. A server restart mid-scan loses the task, and the
 * user starts another — which is a strictly better failure than a key at rest.
 *
 * A task is consumed by the poll that resolves it: completed or expired, it is gone, so a
 * replayed poll of the same task id reads as unknown rather than re-authorizing anything.
 * "Consumed" is claimed before the upstream request rather than deleted after it, because
 * the client's poll interval fires whether or not the previous request came back.
 */
export class QQScanService {
  private readonly tasks = new Map<string, QQScanTask>();
  private readonly now: () => number;
  /** The self-re-arming sweep, alive only while a task is remembered (see `armSweep`). */
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly transport: QQScanTransport,
    opts: QQScanServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Starts a scan: a fresh key, a task registered under it, and the URL for the QR. */
  async start(sessionId: string): Promise<{ taskId: string; qrUrl: string; pollMs: number }> {
    this.sweep();
    const key = newQQScanKey();
    const taskId = await this.transport.createBindTask(key);
    // Evicted after the create rather than before it: a create that failed must not have
    // cost the caller a live code.
    this.evictOwn(sessionId);
    this.tasks.set(taskId, { key, sessionId, createdAt: this.now(), claimed: false });
    this.armSweep();
    return { taskId, qrUrl: qqScanQrUrl(taskId), pollMs: QQ_SCAN_POLL_MS };
  }

  /**
   * Polls one task. Returns null when the task id is not one this Session started (an
   * unknown id, another Session's, one already consumed, or one another poll is resolving
   * right now) — the caller answers 404, which is also what a replay gets.
   */
  async poll(sessionId: string, taskId: string): Promise<QQScanPoll | null> {
    const task = this.tasks.get(taskId);
    if (task === undefined || task.sessionId !== sessionId || task.claimed) return null;
    // CLAIMED before the await, not deleted after it. The client polls on a fixed interval
    // that fires whether or not the previous request came back, so a slow platform leaves
    // several polls of one task overlapping; without the claim every one of them decrypts
    // the secret and binds again. The claim is released below while the task is unresolved.
    task.claimed = true;
    if (this.now() - task.createdAt > QQ_SCAN_TASK_TTL_MS) {
      this.tasks.delete(taskId);
      return { status: "expired" };
    }
    let result: QQBindPollResult;
    try {
      result = await this.transport.pollBindResult(taskId);
    } catch (err) {
      // A request that failed resolved nothing: the task stays pollable, which is what lets
      // the client ride out a transient platform error without dropping the user's code.
      task.claimed = false;
      throw err;
    }
    if (result.status === "expired") {
      this.tasks.delete(taskId);
      return { status: "expired" };
    }
    if (result.status !== "completed") {
      task.claimed = false;
      return { status: result.status };
    }
    // Past here the task is spent whatever happens. Completed with nothing to store, and a
    // payload that will not decrypt, are both states polling again cannot recover from.
    this.tasks.delete(taskId);
    const bot = result.bots[0];
    if (bot === undefined) {
      throw new Error("QQ reported the scan complete but returned no bot");
    }
    const appSecret = decryptQQBotSecret(task.key, bot.encryptedSecret);
    return { status: "completed", bot: { appId: bot.appId, appSecret } };
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

  /**
   * Drops this Session's oldest tasks until one more fits under its own ceiling. Scoped to
   * the caller: the whole point of the per-Session ceiling is that filling it takes a code
   * away from nobody else.
   */
  private evictOwn(sessionId: string): void {
    const own = [...this.tasks].filter(([, task]) => task.sessionId === sessionId);
    if (own.length < QQ_SCAN_MAX_TASKS_PER_SESSION) return;
    own.sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [taskId] of own.slice(0, own.length - QQ_SCAN_MAX_TASKS_PER_SESSION + 1)) {
      this.tasks.delete(taskId);
    }
  }

  /** Drops expired tasks, then the oldest ones if the table is still over its backstop. */
  private sweep(): void {
    const cutoff = this.now() - QQ_SCAN_TASK_TTL_MS;
    for (const [taskId, task] of this.tasks) {
      if (task.createdAt <= cutoff) this.tasks.delete(taskId);
    }
    if (this.tasks.size < QQ_SCAN_MAX_TASKS) return;
    // Age comes from createdAt rather than from the Map's insertion order, so the backstop
    // keeps picking the oldest however a task came to sit where it does in the table.
    const byAge = [...this.tasks].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [taskId] of byAge.slice(0, this.tasks.size - QQ_SCAN_MAX_TASKS + 1)) {
      this.tasks.delete(taskId);
    }
  }

  /**
   * Keeps one unref'd timer alive while any task is remembered, so a scan the user walked
   * away from stops holding its key roughly at the TTL instead of at whenever somebody
   * happens to start the next scan — which may be never, and a key at rest is the one
   * outcome this module is shaped to avoid. It re-arms only while the table is non-empty,
   * and unref'd it is never the reason a process stays alive.
   */
  private armSweep(): void {
    if (this.sweepTimer !== null || this.tasks.size === 0) return;
    const timer = setTimeout(() => {
      this.sweepTimer = null;
      this.sweep();
      this.armSweep();
    }, QQ_SCAN_TASK_TTL_MS);
    timer.unref();
    this.sweepTimer = timer;
  }
}

/** The scan-to-connect transport as a node, so a test stands in a fake for the network. */
export abstract class QQScanTransportHandle extends Interface<{
  transport: Opaque<"QQScanTransport", QQScanTransport>;
}>() {}
@Module()
export class QQScanTransportProvider {
  @Provide() qqScanTransport!: QQScanTransportHandle;
  setup() {
    this.qqScanTransport = { transport: createQQScanTransport() };
  }
}
