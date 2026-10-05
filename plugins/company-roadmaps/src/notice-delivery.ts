/**
 * What the built-in roadmap notices do (notices.ts, builtin-actions.ts): the only place the
 * plugin puts a notice on an employee's desk or into a room session. A write never delivers
 * itself — it sends its notice, which a company workflow may replace — so a new delivery
 * belongs here, behind a notify Action, or nowhere (test/notice-guard.test.ts checks it).
 */
import type { OrgGateway } from "@prismshadow/penguin-server/plugin";
import type { NoticeResult } from "./action-shapes.js";
import { tellSession, type SessionRunner } from "./session-tell.js";

export interface NoticeDeliveryDeps {
  gateway: Pick<OrgGateway, "deliverToDesk">;
  runner: SessionRunner;
  /** Records a desk that could not take a line as roadmap `number`'s `notify_failed`, under `by`. */
  recordFailed(
    projectId: string,
    orgId: string,
    number: number,
    agentId: string,
    error: string,
    by: string,
  ): void;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class NoticeDelivery {
  constructor(private readonly deps: NoticeDeliveryDeps) {}

  /**
   * The desk notices: `line` on each desk of `to`, in order; a desk that cannot take it
   * recorded as `notify_failed` on roadmap `number`, under `by`, and answered among `failed`.
   */
  async desk(
    projectId: string,
    orgId: string,
    number: number,
    to: readonly string[],
    line: string,
    by: string,
  ): Promise<NoticeResult> {
    const out: NoticeResult = { delivered: [], failed: [] };
    for (const agentId of to) {
      try {
        await this.deps.gateway.deliverToDesk(projectId, orgId, agentId, line);
        out.delivered.push(agentId);
      } catch (err) {
        const error = messageOf(err);
        this.deps.recordFailed(projectId, orgId, number, agentId, error, by);
        out.failed.push({ agentId, error });
      }
    }
    return out;
  }

  /** The approval request: `line` into room session `sessionId` of `agentId`. */
  async inSession(sessionId: string, agentId: string, line: string): Promise<NoticeResult> {
    try {
      await tellSession(this.deps.runner, sessionId, line);
      return { delivered: [agentId], failed: [] };
    } catch (err) {
      return { delivered: [], failed: [{ agentId, error: messageOf(err) }] };
    }
  }

  /** The reopening: `line` into each room session of `sessionIds`, the one of `to`'s employee at the same place. */
  async inSessions(
    to: readonly string[],
    sessionIds: readonly string[],
    line: string,
  ): Promise<NoticeResult> {
    const out: NoticeResult = { delivered: [], failed: [] };
    for (const [i, agentId] of to.entries()) {
      const sessionId = sessionIds[i];
      const one: NoticeResult =
        sessionId === undefined
          ? { delivered: [], failed: [{ agentId, error: "no room session named" }] }
          : await this.inSession(sessionId, agentId, line);
      out.delivered.push(...one.delivered);
      out.failed.push(...one.failed);
    }
    return out;
  }
}
