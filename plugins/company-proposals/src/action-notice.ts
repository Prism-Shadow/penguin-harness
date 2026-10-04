/**
 * Notices: what a run's write sends once it committed (`ctx.act.notify`, action-model.ts). A
 * notice is a run of a `notify.*` Action by key — the built-in one delivers the line to each
 * recipient's desk, a company workflow's `action` on the key replaces it — made by the registry
 * as the sending run's caller, recorded `via: "notify"`. It never fails the sending run: a notice
 * refused or failed is listed in that run's `hookErrors`.
 */
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import {
  ActionRefusal,
  type ActionCaller,
  type Notice,
  type NoticeOutcome,
} from "./action-model.js";
import type { RunAnswer, RunRequest } from "./action-registry.js";

/** The keys of notify Actions: run only as the notice of a write, never on their own. */
export const NOTIFY_PREFIX = "notify.";

/**
 * A notice tells people, in nobody's name, what a write did; a `notify.*` Action run on its own
 * would put whatever its caller wrote on a desk under that name. Refused with 403 `notify_direct`.
 */
export function requireNoticeOnly(key: string, req: RunRequest): void {
  if (key.startsWith(NOTIFY_PREFIX) && req.notice !== true) {
    throw new ActionRefusal(
      403,
      "notify_direct",
      `${key} runs only as the notice of a write, not on its own.`,
    );
  }
}

/** The actor a caller resolved from: its session and Agent claims kept, so it resolves the same again. */
export function actorOf(caller: ActionCaller): OrgActor {
  return {
    userId: caller.userId,
    ...(caller.sessionId !== undefined ? { sessionId: caller.sessionId } : {}),
    ...(caller.agentId !== null ? { agentId: caller.agentId } : {}),
  };
}

/**
 * Run `runId`'s notice through `run` (the registry, as that run's caller), with the run's id as
 * its `runId` parameter. Answers how it went; a refusal or a failure — the key resolving to
 * none, a guard or a before hook saying no, the run throwing — is also pushed on `errors`, the
 * sending run's list. Never throws.
 */
export async function sendNotice(
  run: (req: RunRequest) => Promise<RunAnswer>,
  runId: string,
  notice: Notice,
  errors: string[],
): Promise<NoticeOutcome> {
  try {
    const answer = await run({
      key: notice.key,
      subject: notice.subject,
      params: { ...notice.params, runId },
      notice: true,
    });
    return { ok: true, result: answer.result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    errors.push(`${notice.key}: ${error}`);
    return { ok: false, error };
  }
}
