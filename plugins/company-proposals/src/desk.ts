/**
 * How the proposal service speaks to employees: a line of work on each employee's desk, in
 * nobody's name — `[proposal #<n>] ` + what happened + the command to run — sent as the notice
 * `notify.proposal.<event>` of the write that made it happen (notify-actions.ts). The notice is
 * an Action of its own, so a company workflow may replace it; the built-in one delivers here.
 */
import type { OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import {
  noticeFailures,
  type NoticeFailure,
  type NoticeOutcome,
  type NoticeResult,
} from "./action-model.js";
import type { Caller, WriteAct } from "./guards.js";
import { noticeKey, type ProposalNoticeEvent } from "./notify-actions.js";

const PLUGIN_NAME = "company-proposals";

export interface DeskDeps {
  gateway: Pick<OrgGateway, "deliverToDesk">;
  log: (line: string) => void;
  /** Records a delivery that failed as the proposal's `notify_failed` event, under `by`. */
  recordFailed(
    projectId: string,
    orgId: string,
    number: number,
    reason: string,
    by: string,
  ): Promise<void>;
}

function agentPrincipal(agentId: string): string {
  return `agent:${agentId}`;
}

export class ProposalDesk {
  constructor(private readonly deps: DeskDeps) {}

  /**
   * Tells `agentIds` of what a write did, once it committed: the notice of `event` on
   * `subject` (the proposal by default), run through the write's `act.notify`. The caller's own
   * employee is never told of its own act. A desk that cannot take it (the organization or the
   * employee paused, no desk), or a notice that did not run, is pushed on `delivery.hints` and
   * answered, never raised: the write already stands. Without a run's notices (a use case
   * called directly) the line is delivered as the built-in notice would.
   */
  async tell(
    delivery: { hints: string[] },
    org: OrgView,
    p: { number: number },
    caller: Caller,
    act: Pick<WriteAct, "notify"> | undefined,
    event: ProposalNoticeEvent,
    agentIds: readonly string[],
    text: string,
    subject = `proposal:${p.number}`,
  ): Promise<NoticeOutcome> {
    const to = [...new Set(agentIds)].filter((agentId) => agentId !== caller.agentId);
    if (to.length === 0) return { ok: true, result: { delivered: [], failed: [] } };
    const key = noticeKey(event);
    const line = `[proposal #${p.number}] ${text}`;
    const out: NoticeOutcome =
      act?.notify !== undefined
        ? await act.notify({ key, subject, params: { to, text: line } })
        : {
            ok: true,
            result: await this.deliver(org.projectId, org.orgId, p.number, to, line, caller),
          };
    if (!out.ok) {
      delivery.hints.push(`${key} did not run: ${out.error}`);
      return out;
    }
    for (const f of noticeFailures(out.result)) {
      delivery.hints.push(`${agentPrincipal(f.agentId)} not notified: ${f.error}`);
    }
    return out;
  }

  /**
   * What the built-in notices do: `line` on each desk of `to`, in order. A delivery that failed
   * is not silent: the desk is the only way the plugin reaches an employee, so a failure is
   * logged and recorded as a `notify_failed` event (the timeline and the unread count show it)
   * under the caller's name, and answered among `failed`.
   */
  async deliver(
    projectId: string,
    orgId: string,
    number: number,
    to: readonly string[],
    line: string,
    caller: Pick<Caller, "principal">,
  ): Promise<NoticeResult> {
    const out: NoticeResult = { delivered: [], failed: [] };
    for (const agentId of to) {
      try {
        await this.deps.gateway.deliverToDesk(projectId, orgId, agentId, line);
        out.delivered.push(agentId);
      } catch (err) {
        out.failed.push(await this.failed(projectId, orgId, number, caller, agentId, err));
      }
    }
    return out;
  }

  private async failed(
    projectId: string,
    orgId: string,
    number: number,
    caller: Pick<Caller, "principal">,
    agentId: string,
    err: unknown,
  ): Promise<NoticeFailure> {
    const error = err instanceof Error ? err.message : String(err);
    const reason = `${agentPrincipal(agentId)} not notified: ${error}`;
    this.deps.log(`[${PLUGIN_NAME}] proposal #${number}: ${reason}`);
    try {
      await this.deps.recordFailed(projectId, orgId, number, reason, caller.principal);
    } catch (recordErr) {
      this.deps.log(
        `[${PLUGIN_NAME}] proposal #${number}: the failed delivery was not recorded: ${
          recordErr instanceof Error ? recordErr.message : String(recordErr)
        }`,
      );
    }
    const e = err as { status?: unknown; code?: unknown };
    return {
      agentId,
      error,
      ...(typeof e.status === "number" ? { status: e.status } : {}),
      ...(typeof e.code === "string" ? { code: e.code } : {}),
    };
  }
}
