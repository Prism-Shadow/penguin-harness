/**
 * The approvals resource: the tool calls a Session holds for a person's (or a program's)
 * decision, one handler behind both doors.
 *
 *   GET /api/amsp/v1/sessions/:sessionId/approvals[?wait=<1–60>]   the key door (routes.ts)
 *   GET /api/sessions/:sessionId/approvals[?wait=<1–60>]           the cookie door (sessions.ts)
 *
 * The answer is `{ approvals: [{ tool_call, origin? }] }`: each call's `tool_call` record payload,
 * and the child Session chain of a subagent's call. Without `wait` it answers at once. With it,
 * an empty list is held until a call appears — told by the internal `approval_request` the
 * manager publishes on the Session's channel — or the seconds run out (an empty list), or the
 * caller goes away. `wait` outside 1–60 is clamped; anything but a whole number is a 400.
 *
 * Decisions go back through `POST …/approvals/:toolCallId`; the engine then records an
 * `approval_decision`, on the stream like every record.
 */
import type { Context } from "hono";
import { badRequest } from "../http/validate.js";
import type { Channels } from "../hmr/capabilities.js";
import type { SessionManager } from "../runtime/session-manager.js";
import type { ApprovalsResponse } from "@prismshadow/amsp";

export interface ApprovalsDeps {
  manager: Pick<SessionManager, "pendingApprovals">;
  channels: Pick<Channels, "get">;
}

/** The longest a look may wait, in seconds. */
const MAX_WAIT_S = 60;

/** `wait` as seconds (null: answer at once); a value that is not a whole number is a 400. */
function waitSeconds(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^\d{1,6}$/.test(raw)) throw badRequest("wait must be a whole number of seconds (1–60).");
  return Math.min(MAX_WAIT_S, Math.max(1, Number.parseInt(raw, 10)));
}

/** Whether a channel event is the manager's internal `approval_request`. */
function isApprovalRequest(event: string | undefined, data: string): boolean {
  if (event !== "server_event") return false;
  try {
    return (JSON.parse(data) as { type?: unknown }).type === "approval_request";
  } catch {
    return false;
  }
}

export async function pendingApprovals(
  c: Context,
  deps: ApprovalsDeps,
  sessionId: string,
): Promise<Response> {
  const wait = waitSeconds(c.req.query("wait"));
  const list = (): ApprovalsResponse => ({
    approvals: deps.manager.pendingApprovals(sessionId).map((p) => ({
      tool_call: p.toolCall.payload,
      ...(p.origin !== undefined && p.origin.length > 0 ? { origin: [...p.origin] } : {}),
    })),
  });
  let answer = list();
  if (wait === null || answer.approvals.length > 0) return c.json(answer);
  const signal = c.req.raw.signal;
  await new Promise<void>((resolve) => {
    let unsubscribe = () => {};
    const done = (): void => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, wait * 1000);
    signal.addEventListener("abort", done, { once: true });
    unsubscribe = deps.channels.get(sessionId).subscribe((evt) => {
      if (isApprovalRequest(evt.event, evt.data) && list().approvals.length > 0) done();
    });
    if (signal.aborted) done();
  });
  answer = list();
  return c.json(answer);
}
