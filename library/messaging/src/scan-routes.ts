/**
 * The scan-to-connect routes, registered once per contributed {@link ScanFlow} — so a channel
 * that binds by scanning a QR code contributes a flow and writes no route of its own.
 *
 *   POST /api/sessions/:sessionId/messaging/<channel>/scan          start: {taskId, qrUrl, pollMs}
 *   POST /api/sessions/:sessionId/messaging/<channel>/scan/poll     {taskId} → {status} | completed
 *   POST /api/sessions/:sessionId/messaging/<channel>/scan/verify   {taskId, verifyCode} → 204
 *   POST /api/sessions/:sessionId/messaging/<channel>/scan/cancel   {taskId} → 204
 *
 * `verify` exists only for a flow that takes a pairing code (`submitVerifyCode`): WeChat may
 * show digits on the phone that must be typed here, QQ never does, and a route that could only
 * ever answer "unknown task" would be noise in the API.
 *
 * What is the same on every channel lives here: the routes are owner-only throughout — the
 * flow ends in a stored credential, so it is a credential write however little of it the
 * caller types; a scan is refused while the channel's connection is enabled (the host's
 * disable-first rule); a platform failure is a 502 `<channel>_scan_failed` carrying the
 * platform's reason; a task this Session does not have in flight is a 404
 * `<channel>_scan_task_unknown`; and a completed poll is stored by the host — exactly as the
 * channel's PUT would store it — and answered with the account id under the channel's own
 * name for it plus the binding's masked view. The credential itself never appears in an
 * answer: it went to storage without passing back through the browser.
 */
import type { Context, Hono } from "hono";
import { HttpError } from "@prismshadow/penguin-library-http";
import type { AppEnv } from "@prismshadow/penguin-library-http";
import { badRequest, readJson, requireString } from "@prismshadow/penguin-library-http/validate";
import type { SessionRow } from "@prismshadow/penguin-library-session/repos/sessions";
import type { MessagingChannel } from "./connector.js";
import type { ScanCredential, ScanFlow, ScanFlowPoll, ScanFlowStart } from "./scan-flow.js";
import type { MessagingBindingInfo } from "./vocabulary.js";

/** One channel's flow as the routes are given it: the slot's data half, and the flow itself. */
export interface MessagingScanFlow {
  readonly channel: MessagingChannel;
  /**
   * The key a completed poll's answer names the scanned account under — the word the channel
   * uses for it, which is what its client reads: QQ's `appId`, WeChat's `botId`.
   */
  readonly accountIdField: string;
  readonly flow: ScanFlow;
}

/** What the routes need from the messaging router they are registered on. */
export interface ScanRouteHost {
  /** The Session the request names, authorized as its Project's owner; throws otherwise. */
  ownerSession(c: Context<AppEnv>): SessionRow;
  /** The disable-first rule: throws while this Session's connection on the channel is enabled. */
  guardScanStart(sessionId: string, channel: MessagingChannel): void;
  /** Stores what a completed scan produced and answers with the stored binding's masked view. */
  saveScanResult(
    sessionId: string,
    channel: MessagingChannel,
    credential: ScanCredential,
  ): Promise<MessagingBindingInfo>;
}

/** Registers one channel's scan routes on the session-level messaging router. */
export function registerScanRoutes(
  app: Hono<AppEnv>,
  { channel, accountIdField, flow }: MessagingScanFlow,
  host: ScanRouteHost,
): void {
  const base = `/:sessionId/messaging/${channel}/scan`;
  const platformFailed = (err: unknown): HttpError =>
    new HttpError(502, `${channel}_scan_failed`, err instanceof Error ? err.message : String(err));
  const taskUnknown = (): HttpError =>
    new HttpError(
      404,
      `${channel}_scan_task_unknown`,
      "This scan is no longer in progress: start a new one.",
    );

  app.post(base, async (c) => {
    const row = host.ownerSession(c);
    host.guardScanStart(row.sessionId, channel);
    let started: ScanFlowStart;
    try {
      started = await flow.start(row.sessionId);
    } catch (err) {
      throw platformFailed(err);
    }
    return c.json(started);
  });

  app.post(`${base}/poll`, async (c) => {
    const row = host.ownerSession(c);
    const body = await readJson(c);
    const taskId = requireString(body, "taskId", { minLen: 1, maxLen: 500 });
    let result: ScanFlowPoll | null;
    try {
      result = await flow.poll(row.sessionId, taskId);
    } catch (err) {
      throw platformFailed(err);
    }
    // Unknown, another Session's, already resolved — or, on a flow that refuses overlaps,
    // claimed by a poll still in flight. Neither a replay nor an overlap may re-authorize.
    if (result === null) throw taskUnknown();
    if (result.status !== "completed" || result.credential === undefined) {
      return c.json({ status: result.status });
    }
    const binding = await host.saveScanResult(row.sessionId, channel, result.credential);
    return c.json({
      status: "completed",
      [accountIdField]: result.credential.accountId,
      binding,
    });
  });

  // Only a flow whose platform interposes a pairing code has somewhere for the digits to go.
  // They ride the next poll rather than a request of their own (the platform takes the code
  // as a parameter of its status call), so this records them and answers 204.
  const submitVerifyCode = flow.submitVerifyCode?.bind(flow);
  if (submitVerifyCode !== undefined) {
    app.post(`${base}/verify`, async (c) => {
      const row = host.ownerSession(c);
      const body = await readJson(c);
      const taskId = requireString(body, "taskId", { minLen: 1, maxLen: 500 });
      // The platform shows a short numeric code; the bound is generous rather than exact
      // because the length is not documented and a rejected digit is the platform's answer to
      // give, not this route's.
      const verifyCode = requireString(body, "verifyCode", { minLen: 1, maxLen: 32 }).trim();
      if (verifyCode === "") throw badRequest("verifyCode must not be blank.");
      if (!submitVerifyCode(row.sessionId, taskId, verifyCode)) throw taskUnknown();
      return c.body(null, 204);
    });
  }

  app.post(`${base}/cancel`, async (c) => {
    const row = host.ownerSession(c);
    const body = await readJson(c);
    flow.cancel(row.sessionId, requireString(body, "taskId", { minLen: 1, maxLen: 500 }));
    return c.body(null, 204);
  });
}
