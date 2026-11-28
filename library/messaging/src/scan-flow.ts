/**
 * The scan-to-connect seam: what the HTTP surface needs from one channel's "bind by scanning a
 * QR code" flow (QQ and WeChat today; a further channel implements the same interface and
 * contributes it to `MessagingModule.scanFlows`, see bridge.ts's MessagingSlots).
 *
 * A flow owns everything channel-specific — the platform's protocol, what it keeps in memory
 * between polls (QQ's AES key, WeChat's poll handle) and how a confirmed scan turns into a
 * stored config — and hands the routes a channel-neutral view: a task to start, a status to
 * poll, an optional pairing code to record, and a task to drop. The routes (scan-routes.ts)
 * own what is the same on every channel: the owner check, the disable-first rule, the error
 * codes, and storing what a completed scan produced.
 *
 * Every method is scoped to the Session that started the task: a task id another Session
 * started reads as unknown, which is what keeps one Session from polling another's credential
 * out of a flow.
 */

/** A started scan: the handle the browser polls with, the URL it renders as a QR, its interval. */
export interface ScanFlowStart {
  taskId: string;
  qrUrl: string;
  pollMs: number;
}

/**
 * The binding a confirmed scan produced, ready to store: the account it signs in as, and the
 * channel's own config document — the same pair a typed PUT would store.
 */
export interface ScanCredential {
  accountId: string;
  config: Record<string, unknown>;
}

/** Where a scan stands, and the credential once it landed. */
export interface ScanFlowPoll {
  /** The channel's own status word; `completed` is the one the routes act on. */
  status: string;
  /** Present only on `completed`: for the caller to store, never to answer with. */
  credential?: ScanCredential;
}

export interface ScanFlow {
  /** Starts a scan for this Session; throws with the platform's reason when it cannot. */
  start(sessionId: string): Promise<ScanFlowStart>;
  /**
   * Polls one task. Null when the task is not one this Session has in flight — unknown,
   * another Session's, already resolved, or (on a flow that refuses overlaps) claimed by a poll
   * still running. Throws with the platform's reason when the request itself failed, which
   * leaves the task pollable.
   */
  poll(sessionId: string, taskId: string): Promise<ScanFlowPoll | null>;
  /**
   * Records the pairing code the person read off their phone, for the next poll to carry.
   * False for a task this Session does not have in flight. Only a flow whose platform asks for
   * one implements it, and only such a flow is given the `verify` route.
   */
  submitVerifyCode?(sessionId: string, taskId: string, verifyCode: string): boolean;
  /** Drops a task the user walked away from (the editor's cancel, and its unmount). */
  cancel(sessionId: string, taskId: string): void;
  /** Forgets everything this Session has in flight. */
  cancelSession(sessionId: string): void;
}
