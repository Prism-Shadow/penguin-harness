/**
 * The `system` lines an organization writes, built once as a sentence and a structure
 * together. `text` is the English line the file keeps and the CLI falls back to; `notice`
 * is the same fact as a kind plus string parameters, so a client renders it in the reader's
 * language and with display names. Building both here is what stops the two from drifting:
 * a kind that changes its parameters changes its sentence in the same function.
 */
import type { OrgChannelMessage, OrgChannelNotice } from "../../api/types.js";

/** One system line: the English sentence and its structured twin. */
export interface SystemLine {
  text: string;
  notice: OrgChannelNotice;
}

/** A line as the message body the channel writer takes; a `system` line mentions nobody unless the caller says so. */
export function systemMessage(line: SystemLine): Omit<OrgChannelMessage, "id" | "time"> {
  return { sender: "system", hop: 0, text: line.text, mentions: [], notice: line.notice };
}

export function employeeJoined(agent: string, title: string, reportsTo: string): SystemLine {
  return {
    text: `${agent} joined as ${title}, reporting to ${reportsTo}.`,
    notice: { kind: "employee_joined", params: { agent, title, reportsTo } },
  };
}

export function employeeLeft(agent: string, reportsTo: string): SystemLine {
  return {
    text: `${agent} left the organization; reports now go to ${reportsTo}.`,
    notice: { kind: "employee_left", params: { agent, reportsTo } },
  };
}

export function channelCreated(by: string): SystemLine {
  return {
    text: `${by} created the channel.`,
    notice: { kind: "channel_created", params: { by } },
  };
}

export function channelArchiveChanged(by: string, archived: boolean): SystemLine {
  return {
    text: `${by} ${archived ? "archived" : "unarchived"} the channel.`,
    notice: { kind: archived ? "channel_archived" : "channel_unarchived", params: { by } },
  };
}

/** A member added: by itself (a person joining) or by another member. */
export function channelMemberAdded(by: string, principal: string): SystemLine {
  if (by === principal) {
    return {
      text: `${principal} joined the channel.`,
      notice: { kind: "channel_joined", params: { principal } },
    };
  }
  return {
    text: `${by} invited ${principal} to the channel.`,
    notice: { kind: "channel_invited", params: { by, principal } },
  };
}

/** A member removed: itself (leaving) or by someone else. */
export function channelMemberRemoved(by: string, principal: string): SystemLine {
  if (by === principal) {
    return {
      text: `${principal} left the channel.`,
      notice: { kind: "channel_left", params: { principal } },
    };
  }
  return {
    text: `${by} removed ${principal} from the channel.`,
    notice: { kind: "channel_removed", params: { by, principal } },
  };
}

export interface BudgetFacts {
  agent: string;
  period: string;
  percent: number;
  cost: number;
  budget: number;
}

const money = (n: number): string => n.toFixed(2);

const budgetParams = (f: BudgetFacts): Record<string, string> => ({
  agent: f.agent,
  period: f.period,
  percent: String(f.percent),
  cost: money(f.cost),
  budget: money(f.budget),
});

export function budgetWarned(f: BudgetFacts): SystemLine {
  return {
    text: `Budget warning: ${f.agent} has used ${f.percent}% of its ${f.period} budget (${money(f.cost)} / ${money(f.budget)} USD).`,
    notice: { kind: "budget_warned", params: budgetParams(f) },
  };
}

export function budgetPaused(f: BudgetFacts): SystemLine {
  return {
    text: `Budget pause: ${f.agent} reached ${f.percent}% of its ${f.period} budget (${money(f.cost)} / ${money(f.budget)} USD). Its calendar and its subordinates' are paused until the next month or a raised budget; mentions and direct conversations still work.`,
    notice: { kind: "budget_paused", params: budgetParams(f) },
  };
}

/** The ticket changes that reach people in the all-hands channel. */
export type TicketNoticeKind = "ticket_blocked" | "ticket_done" | "ticket_rejected";

const TICKET_STATE: Record<TicketNoticeKind, string> = {
  ticket_blocked: "blocked",
  ticket_done: "done",
  ticket_rejected: "rejected",
};

/**
 * A ticket's state reaching the all-hands channel. `mentions` are the principals the line
 * @-mentions; an empty list still writes the line — the board reads completions from the
 * channel, it is only the mention badge that is reserved for who asked for it.
 */
export function ticketState(
  kind: TicketNoticeKind,
  ticket: string,
  title: string,
  mentions: readonly string[],
): SystemLine {
  const head = `Ticket ${ticket} (${title}) is now ${TICKET_STATE[kind]}`;
  const tail = mentions.length === 0 ? "" : `: ${mentions.map((m) => `@${m}`).join(" ")}`;
  return { text: `${head}${tail}`, notice: { kind, params: { ticket, title } } };
}
