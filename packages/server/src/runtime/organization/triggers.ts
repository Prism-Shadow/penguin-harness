/**
 * Delivering work to employees. Every automatic trigger is one user input sent to a
 * session: an `[org_trigger]` block (built by core's marker module, which also owns the
 * parser the frontend folds it with) followed by the trigger's content. Desk sessions
 * are opened lazily here on first use and renewed when the CEO reassigns a workspace;
 * ticket sessions are opened per start.
 */
import { buildOrgTriggerMessage, userText } from "@prismshadow/penguin-core";
import type { OrgTriggerOrigin } from "@prismshadow/penguin-core";
import type { TicketDoc } from "../../organization/files.js";
import { serializeTicket } from "../../organization/files.js";
import type { OrgDeps } from "./deps.js";
import type { LoadedOrg } from "./model.js";
import { employeeLine } from "./model.js";

export interface DeskHandle {
  sessionId: string;
  workspace: string;
  openedAt: string;
  created: boolean;
}

export type DeskResult = { ok: true; desk: DeskHandle } | { ok: false; error: string };

/**
 * The employee's desk session: reused while it exists and still sits in the workspace the
 * chart resolves to; otherwise (first use, deleted session, reassigned workspace, or an
 * explicit renewal) a new one is opened and the ledger rewritten. The old session stays as
 * history under `previous` so its cost keeps counting.
 */
export async function ensureDesk(
  deps: OrgDeps,
  org: LoadedOrg,
  agentId: string,
  opts: { renew?: boolean } = {},
): Promise<DeskResult> {
  const employee = org.byId.get(agentId);
  if (!employee) return { ok: false, error: `${agentId} is not an employee of ${org.orgId}` };
  if (!(await deps.agents.exists(org.projectId, agentId))) {
    return { ok: false, error: `Agent ${agentId} does not exist` };
  }
  const workspace = await deps.store.resolveWorkspace(org.dir, employee.workspace);
  if (workspace === null) {
    return {
      ok: false,
      error: `workspace directory does not exist for ${agentId}: ${employee.workspace}`,
    };
  }
  const existing = org.desks[agentId];
  if (
    existing &&
    opts.renew !== true &&
    existing.workspace === workspace &&
    deps.sessions.findById(existing.sessionId) !== null
  ) {
    return {
      ok: true,
      desk: {
        sessionId: existing.sessionId,
        workspace: existing.workspace,
        openedAt: existing.openedAt,
        created: false,
      },
    };
  }
  let created: { sessionId: string; workspace: string };
  try {
    created = await deps.sessionCreator.createSession({
      projectId: org.projectId,
      agentId,
      workspace,
      ...(employee.model !== undefined
        ? { modelId: employee.model.modelId, provider: employee.model.provider }
        : {}),
      approvalMode: org.config.approvalMode,
    });
  } catch (err) {
    return {
      ok: false,
      error: `failed to open a desk session for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const name = await deps.agents.displayName(org.projectId, agentId);
  // A manual title: the auto-title pass only fills empty titles, so the desk keeps its name.
  deps.sessions.updateTitle(created.sessionId, `${name} 的工位`);
  const openedAt = new Date(deps.now?.() ?? Date.now()).toISOString();
  const previous = existing ? [...existing.previous, existing.sessionId] : [];
  org.desks[agentId] = {
    sessionId: created.sessionId,
    workspace: created.workspace,
    openedAt,
    previous,
  };
  await deps.store.writeDesks(org.dir, org.desks);
  syncDeskCache(deps, org);
  return {
    ok: true,
    desk: { sessionId: created.sessionId, workspace: created.workspace, openedAt, created: true },
  };
}

/** Projects the ledger into `org_sessions` (current desks and their history). */
export function syncDeskCache(deps: OrgDeps, org: LoadedOrg): void {
  const rows: Array<{ sessionId: string; agentId: string; current: boolean }> = [];
  for (const [agentId, desk] of Object.entries(org.desks)) {
    rows.push({ sessionId: desk.sessionId, agentId, current: true });
    for (const prev of desk.previous) rows.push({ sessionId: prev, agentId, current: false });
  }
  deps.cache.syncDeskSessions(org.projectId, org.orgId, rows);
}

export type DeskTrigger = Omit<OrgTriggerOrigin, "org" | "employee" | "budget">;

export type DispatchOutcome = "sent" | "queued" | "skipped";

/**
 * Sends one work run to an employee's desk: opens the desk if needed, prefixes the block,
 * queues behind a running Task (`queueIfBusy`: a busy desk never loses a trigger, it works
 * it next), records the chain hop and notifies the Project's users.
 */
export async function dispatchToDesk(
  deps: OrgDeps,
  org: LoadedOrg,
  agentId: string,
  trigger: DeskTrigger,
  body: string,
  opts: { hop: number; budget?: string },
): Promise<DispatchOutcome> {
  const desk = await ensureDesk(deps, org, agentId);
  if (!desk.ok) {
    deps.errors.record({
      source: "organization",
      err: new Error(desk.error),
      code: "org_desk_unavailable",
      ctx: { projectId: org.projectId, agentId },
    });
    return "skipped";
  }
  const origin: OrgTriggerOrigin = {
    org: org.orgId,
    employee: employeeLine(org, agentId),
    ...trigger,
    ...(opts.budget !== undefined ? { budget: opts.budget } : {}),
  };
  const text = buildOrgTriggerMessage(origin, body);
  let queued = false;
  try {
    // sender "server": in the Trace this user turn was injected by the organization scheduler, not typed by a person.
    const res = await deps.runner.startTask(desk.desk.sessionId, [userText(text, "server")], {
      queueIfBusy: true,
    });
    queued = res.queued === true;
  } catch (err) {
    deps.errors.record({
      source: "organization",
      err,
      code: "org_dispatch_failed",
      ctx: { projectId: org.projectId, agentId, sessionId: desk.desk.sessionId },
    });
    return "skipped";
  }
  deps.cache.setTriggerHop(desk.desk.sessionId, opts.hop);
  deps.notifyProject(org.projectId, {
    type: "org_run",
    projectId: org.projectId,
    orgId: org.orgId,
    agentId,
    sessionId: desk.desk.sessionId,
    kind: trigger.kind,
  });
  return queued ? "queued" : "sent";
}

/**
 * Opens a ticket session: an ordinary session of the employee's Agent in the desk's (or a
 * chosen) workspace, appended to the ticket's `Sessions` header — the fact that makes the
 * session the ticket's — and started with the whole ticket as its first input.
 */
export async function openTicketSession(
  deps: OrgDeps,
  org: LoadedOrg,
  ticket: { ticketId: string; column: TicketDoc["status"]; doc: TicketDoc },
  agentId: string,
  opts: { message?: string; workspace?: string; budget?: string },
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const employee = org.byId.get(agentId);
  if (!employee) return { ok: false, error: `${agentId} is not an employee of ${org.orgId}` };
  const workspace = await deps.store.resolveWorkspace(
    org.dir,
    opts.workspace ?? employee.workspace,
  );
  if (workspace === null) {
    return {
      ok: false,
      error: `workspace directory does not exist: ${opts.workspace ?? employee.workspace}`,
    };
  }
  let created: { sessionId: string; workspace: string };
  try {
    created = await deps.sessionCreator.createSession({
      projectId: org.projectId,
      agentId,
      workspace,
      ...(employee.model !== undefined
        ? { modelId: employee.model.modelId, provider: employee.model.provider }
        : {}),
      approvalMode: org.config.approvalMode,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const n = ticket.doc.sessions.length + 1;
  deps.sessions.updateTitle(created.sessionId, `${ticket.doc.title} #${n}`);
  ticket.doc.sessions = [...ticket.doc.sessions, created.sessionId];
  await deps.store.writeTicket(org.dir, ticket.ticketId, ticket.column, ticket.doc);
  deps.cache.addTicketSession(
    org.projectId,
    org.orgId,
    ticket.ticketId,
    created.sessionId,
    agentId,
  );
  // Messages a ticket session sends carry hop 1: it was opened by a work run, not by a person.
  deps.cache.setTriggerHop(created.sessionId, 0);
  const origin: OrgTriggerOrigin = {
    org: org.orgId,
    employee: employeeLine(org, agentId),
    kind: "ticket_work",
    ticket: ticket.ticketId,
    ...(opts.budget !== undefined ? { budget: opts.budget } : {}),
  };
  const body = [
    opts.message !== undefined && opts.message.trim() !== ""
      ? `Note from the desk: ${opts.message.trim()}\n`
      : "",
    "The ticket, as filed:",
    "",
    serializeTicket(ticket.doc).trimEnd(),
  ]
    .filter((l) => l !== "")
    .join("\n");
  try {
    await deps.runner.startTask(created.sessionId, [
      userText(buildOrgTriggerMessage(origin, body), "server"),
    ]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  deps.notifyProject(org.projectId, {
    type: "org_run",
    projectId: org.projectId,
    orgId: org.orgId,
    agentId,
    sessionId: created.sessionId,
    kind: "ticket_work",
  });
  deps.notifyProject(org.projectId, {
    type: "org_ticket",
    projectId: org.projectId,
    orgId: org.orgId,
    ticketId: ticket.ticketId,
    change: "session_started",
  });
  return { ok: true, sessionId: created.sessionId };
}
