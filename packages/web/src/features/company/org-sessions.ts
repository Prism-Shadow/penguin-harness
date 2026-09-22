/**
 * The company sidebar's 工位 group, as pure shaping (unit tested) over the organization's
 * chart, its sessions route and the live statuses the user channel has reported: one row per
 * EMPLOYEE, in chart order, whether or not these caches already name its desk session. The
 * roster is the chart's (the sessions route only knows employees whose desk is in the ledger);
 * the state is the live one wherever an event has named the desk session.
 *
 * The employees' own states (the chart's dots, the overview's counts) are corrected the same
 * way by `liveEmployeeStates` at the bottom of this file, which reads the sessions attached to
 * tickets too — a ticket session running is its employee running, even though the sidebar
 * lists no ticket sessions of its own (they are reached from the ticket that started them).
 *
 * Both take their run state from the LIVE statuses first, because the two snapshots behind
 * them only move on an organization event: the sessions route is re-read when a run is
 * dispatched (`org_run`) or a ticket moves, and the chart when a summary does — and a run
 * ENDING publishes none of those. A desk would sit on 「运行中」 until some unrelated event
 * happened to arrive. The live statuses are every `session_state` the user event channel has
 * reported, and that channel reports every flip of every Session, so they are the state that
 * is actually current; the snapshots stand in for a Session no event has named.
 */
import type {
  MessagingChannel,
  OrgChartResponse,
  OrgEmployeeState,
  OrgSessionsResponse,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import type { SessionActivity } from "../../lib/session-activity";

/**
 * Live run statuses by Session id — every `session_state` the user event channel has reported,
 * as the session list store remembers them (state/sessions.tsx, useLiveSessionStatuses). A
 * Session no event has named is simply absent, and the caller falls back to the snapshot it
 * does have.
 */
export type LiveSessionStatuses = ReadonlyMap<string, SessionStatus>;

/**
 * One employee's desk row. `sessionId` is null only while neither cache names the employee's
 * desk — the server opens one at hire time and re-opens a missing one on its next pass, so
 * this is the window between a hire and the next read of the chart or the sessions route.
 */
export interface OrgDeskRow {
  agentId: string;
  /** The employee's display name — the row title, whatever the session's own title says. */
  name: string;
  /** The employee's job title, shown as the row's tooltip. */
  jobTitle: string;
  sessionId: string | null;
  status: SessionStatus;
  /**
   * The channel of the desk's enabled messaging binding, from the sessions route's own row;
   * absent when it has none, or while that route has not listed the desk.
   */
  messagingChannel?: MessagingChannel;
}

/**
 * Desk rows in chart order — the reporting line, which is how the organization reads. The
 * chart is the roster; the run state comes from the live statuses, then from the sessions
 * route's snapshot, then from the chart's own `state` — a desk the sessions route has not
 * listed yet (it was opened between the two reads) still shows that it is running. Without a
 * chart yet (the first read of an organization) the sessions route stands in: it walks the
 * same chart server-side, so the order holds and only employees without a desk are missing
 * until the chart lands.
 *
 * The messaging mark is the sessions route's alone: the chart carries no binding, and the
 * development list — where a Session's mark used to be read — never holds a desk.
 */
export function deskRows(
  chart: OrgChartResponse | null,
  sessions: OrgSessionsResponse | undefined,
  live?: LiveSessionStatuses,
): OrgDeskRow[] {
  const snapshot = new Map((sessions?.desks ?? []).map((d) => [d.agentId, d]));
  if (chart === null) {
    return (sessions?.desks ?? []).map((d) => ({
      agentId: d.agentId,
      name: d.name,
      jobTitle: "",
      sessionId: d.sessionId,
      status: live?.get(d.sessionId) ?? d.status,
      ...(d.messagingChannel !== undefined ? { messagingChannel: d.messagingChannel } : {}),
    }));
  }
  return chart.employees.map((e) => {
    const desk = snapshot.get(e.agentId);
    const sessionId = desk?.sessionId ?? e.desk?.sessionId ?? null;
    const liveStatus = sessionId === null ? undefined : live?.get(sessionId);
    return {
      agentId: e.agentId,
      name: e.name,
      jobTitle: e.title,
      sessionId,
      status: liveStatus ?? desk?.status ?? (e.state === "running" ? "running" : "idle"),
      ...(desk?.messagingChannel !== undefined ? { messagingChannel: desk.messagingChannel } : {}),
    };
  });
}

/**
 * The sessions route's answer with one desk's messaging mark set to `channel` (null clears
 * it) — what binding or unbinding a desk from its row menu writes into the loaded copy, so the
 * row follows at once instead of at the next organization event. The same object when no desk
 * names `sessionId` or the mark already says so, so a store holding it spends no render.
 */
export function withDeskMessagingChannel(
  sessions: OrgSessionsResponse,
  sessionId: string,
  channel: MessagingChannel | null,
): OrgSessionsResponse {
  const at = sessions.desks.findIndex((d) => d.sessionId === sessionId);
  if (at === -1 || (sessions.desks[at]!.messagingChannel ?? null) === channel) return sessions;
  const desk = { ...sessions.desks[at]! };
  if (channel === null) delete desk.messagingChannel;
  else desk.messagingChannel = channel;
  const desks = sessions.desks.slice();
  desks[at] = desk;
  return { ...sessions, desks };
}

/**
 * The title the organization gives each of its ticket sessions, by Session id — what the
 * sidebar's Temporary group draws. The organization's own sessions route is the source because
 * the development list excludes organization rows and cannot be asked (see the session list's
 * `excludeOrg`); a session the route does not name keeps the title its ticket listed it under.
 */
export function ticketSessionTitles(
  sessions: OrgSessionsResponse | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const ticket of sessions?.tickets ?? []) {
    for (const s of ticket.sessions) {
      if (s.title !== undefined && s.title !== "") out.set(s.sessionId, s.title);
    }
  }
  return out;
}

/**
 * The glyph a desk row draws: the same live states the ordinary session list shows (an
 * hourglass while running, the squeeze while compacting), and nothing when settled — a desk
 * row has no read marker of its own, so it never claims "unread".
 */
export function orgRowActivity(status: SessionStatus): SessionActivity {
  if (status === "running") return "running";
  if (status === "compacting") return "compacting";
  return null;
}

/**
 * One employee's run state, from the Sessions the organization attributes to it: running while
 * any of them is running or compacting, idle once all of them have settled, and — when nothing
 * is known about any of them — the state the chart itself reported.
 *
 * Each Session is judged by its live status where an event has named it and by the
 * organization's own snapshot otherwise, which is exactly how the desk and ticket rows draw
 * their marks, so the chart and the sidebar can never say different things about the same run.
 *
 * `paused` is not a run state — the budget stopped the employee, and no Session can say
 * otherwise — so it is returned untouched.
 */
function employeeLiveState(
  state: OrgEmployeeState,
  own: ReadonlyArray<{ sessionId: string; status?: SessionStatus }>,
  live: LiveSessionStatuses | undefined,
): OrgEmployeeState {
  if (state === "paused") return "paused";
  let known = false;
  for (const session of own) {
    const status = live?.get(session.sessionId) ?? session.status;
    if (status === undefined) continue;
    known = true;
    if (status === "running" || status === "compacting") return "running";
  }
  return known ? "idle" : state;
}

/**
 * The employees' run states corrected by the live session list, by agent id — what the org
 * chart's dots and the overview's counts draw instead of the chart's own `state`.
 *
 * An employee's Sessions are its desk (named by the chart's entry and by the sessions route,
 * which may know one the other does not yet) and every session attached to a ticket it is
 * working. Both snapshots are re-read only on an organization event, and a run ending
 * publishes none of those, so an employee that finished kept its running dot until something
 * unrelated moved.
 */
export function liveEmployeeStates<
  T extends { agentId: string; state: OrgEmployeeState; desk?: { sessionId: string } },
>(
  employees: readonly T[],
  sessions: OrgSessionsResponse | undefined,
  live?: LiveSessionStatuses,
): ReadonlyMap<string, OrgEmployeeState> {
  const deskOf = new Map((sessions?.desks ?? []).map((d) => [d.agentId, d]));
  const ticketsOf = new Map<string, Array<{ sessionId: string; status: SessionStatus }>>();
  for (const t of sessions?.tickets ?? []) {
    for (const s of t.sessions) {
      const entry = { sessionId: s.sessionId, status: s.status };
      const list = ticketsOf.get(s.agentId);
      if (list) list.push(entry);
      else ticketsOf.set(s.agentId, [entry]);
    }
  }
  const out = new Map<string, OrgEmployeeState>();
  for (const e of employees) {
    const desk = deskOf.get(e.agentId);
    const own: Array<{ sessionId: string; status?: SessionStatus }> = [];
    // The chart's own desk id carries no status: it contributes only what the live list says.
    if (e.desk !== undefined) own.push({ sessionId: e.desk.sessionId });
    if (desk !== undefined) own.push({ sessionId: desk.sessionId, status: desk.status });
    own.push(...(ticketsOf.get(e.agentId) ?? []));
    out.set(e.agentId, employeeLiveState(e.state, own, live));
  }
  return out;
}
