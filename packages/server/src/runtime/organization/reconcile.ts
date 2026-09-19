/**
 * One reconcile pass over an organization — the same pass whether the scheduler's timer
 * or a route's write asks for it. Files in, decisions out: caches are projected from the
 * ledger and the tickets, missing desks are opened and desks renewed where the chart moved
 * them, due calendar events fire (carrying the ticket changes queued since the employee's
 * last sweep), ticket changes are recorded and queued, new channel mentions are delivered,
 * budgets are checked, and every employee's company plugins are brought up to the library's
 * version.
 * Missed work is never backfilled: a slot that passed while the server was down, the
 * organization paused or the switch off is consumed and skipped, like a schedule.
 */
import { createHash } from "node:crypto";
import { comparePluginVersions } from "@prismshadow/penguin-core";
import type { OrgCalendarOutcome, OrgChannelMessage, OrgTicketChange } from "../../api/types.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import type { ChannelConfig, TicketDoc } from "../../organization/files.js";
import { parseChannelMessageLine, serializeChannelMessageLine } from "../../organization/files.js";
import { agentPrincipal, parsePrincipal, principalAgentId } from "../../organization/principal.js";
import { DEFAULT_CHANNEL_ID } from "../../organization/paths.js";
import { zonedDate } from "../../organization/zoned.js";
import { latestSlotAt, slotInWindow } from "../schedule-file.js";
import { budgetLine, computeSpend, pausedEmployees } from "./budget.js";
import type { OrgSpend, TicketForSpend } from "./budget.js";
import { DEFAULT_EMPLOYEE_PLUGINS } from "./deps.js";
import type { OrgDeps } from "./deps.js";
import { deskDigest } from "./digest.js";
import { loadOrg, sharedWorkspace } from "./model.js";
import type { LoadedOrg } from "./model.js";
import { budgetPaused, budgetWarned, systemMessage } from "./notices.js";
import type { SystemLine } from "./notices.js";
import { dispatchToDesk, ensureDesk, syncDeskCache } from "./triggers.js";

export interface LoadedTicket extends TicketForSpend {
  column: TicketDoc["status"];
  relPath: string;
}

export interface TicketListing {
  tickets: LoadedTicket[];
  /** Files that could not be parsed, or ids that appear in two columns. */
  invalid: Array<{ path: string; error: string }>;
}

const nowOf = (deps: OrgDeps): number => deps.now?.() ?? Date.now();

function recordError(
  deps: OrgDeps,
  org: LoadedOrg,
  code: string,
  message: string,
  agentId?: string,
): void {
  deps.errors.record({
    source: "organization",
    err: new Error(message),
    code,
    ctx: { projectId: org.projectId, ...(agentId !== undefined ? { agentId } : {}) },
  });
}

/** Every ticket file, parsed; an unparsable file or a duplicated id is reported and left out. */
export async function listTickets(deps: OrgDeps, org: LoadedOrg): Promise<TicketListing> {
  const files = await deps.store.listTickets(org.dir);
  const seen = new Map<string, number>();
  for (const f of files) seen.set(f.ticketId, (seen.get(f.ticketId) ?? 0) + 1);
  const tickets: LoadedTicket[] = [];
  const invalid: Array<{ path: string; error: string }> = [];
  for (const f of files) {
    if ((seen.get(f.ticketId) ?? 0) > 1) {
      invalid.push({
        path: f.relPath,
        error: `ticket id ${f.ticketId} appears in more than one column`,
      });
      continue;
    }
    if (!f.parsed.ok) {
      invalid.push({ path: f.relPath, error: f.parsed.error });
      continue;
    }
    if (f.parsed.value.status !== f.column) {
      invalid.push({
        path: f.relPath,
        error: `Status is ${f.parsed.value.status} but the file sits in ${f.column}`,
      });
      continue;
    }
    tickets.push({
      ticketId: f.ticketId,
      column: f.column,
      relPath: f.relPath,
      doc: f.parsed.value,
    });
  }
  for (const bad of invalid) {
    recordError(deps, org, "org_ticket_invalid", `Invalid ticket ${bad.path}: ${bad.error}`);
  }
  return { tickets, invalid };
}

/**
 * The session rows an organization's files name as its own: every desk in the ledger, current
 * and previous, then every session a ticket's `sessions` lists, with that ticket's id. Both
 * files are hand-editable and what is written through the result outlives the caches (the
 * `client` stamp, the approval mode), so a name with no row, or naming a row of another
 * Project, is not the organization's and is left out.
 */
function ownedSessions(
  deps: OrgDeps,
  org: LoadedOrg,
  tickets: readonly LoadedTicket[],
): { desks: SessionRow[]; tickets: Array<{ ticketId: string; row: SessionRow }> } {
  const rowOf = (sessionId: string): SessionRow | null => {
    const row = deps.sessions.findById(sessionId);
    return row !== null && row.projectId === org.projectId ? row : null;
  };
  const desks: SessionRow[] = [];
  for (const desk of Object.values(org.desks)) {
    for (const sessionId of [desk.sessionId, ...desk.previous]) {
      const row = rowOf(sessionId);
      if (row !== null) desks.push(row);
    }
  }
  const ticketRows: Array<{ ticketId: string; row: SessionRow }> = [];
  for (const t of tickets) {
    for (const sessionId of t.doc.sessions) {
      const row = rowOf(sessionId);
      if (row !== null) ticketRows.push({ ticketId: t.ticketId, row });
    }
  }
  return { desks, tickets: ticketRows };
}

/**
 * Projects the ledger and the tickets' `sessions` fields into the two session caches, and
 * stamps `client = "org"` on every session row those files name. The caches are rebuilt from
 * the files on every pass and vanish with the organization; the stamp is written once per row
 * and stays, which is what keeps a desk or ticket session out of development mode's list
 * after the organization is deleted or company mode is switched off. It also backfills the
 * sessions of organizations that already existed before the marker did — one pass marks them
 * all. Sessions of organizations deleted before then are never seen again and stay unmarked.
 */
export function syncCaches(deps: OrgDeps, org: LoadedOrg, tickets: readonly LoadedTicket[]): void {
  syncDeskCache(deps, org);
  const owned = ownedSessions(deps, org, tickets);
  deps.cache.syncTicketSessions(
    org.projectId,
    org.orgId,
    owned.tickets.map(({ ticketId, row }) => ({
      ticketId,
      sessionId: row.sessionId,
      agentId: row.agentId,
    })),
  );
  deps.sessions.markOrgClient(
    [...owned.desks, ...owned.tickets.map((t) => t.row)].map((row) => row.sessionId),
  );
}

/**
 * Carries the organization's approval mode onto every session it owns (see `ownedSessions`)
 * that is not archived. A desk or ticket session takes the mode of the moment it is opened and
 * its approvals read its own row, so without this a changed mode would reach only the sessions
 * opened after the change. A session mid-run applies it from its next approval decision, which
 * re-reads the row; an archived session keeps the mode it had. Run only when the mode actually
 * changed: until then, a session whose own mode was changed from its composer keeps it.
 */
export function syncApprovalMode(
  deps: OrgDeps,
  org: LoadedOrg,
  tickets: readonly LoadedTicket[],
): void {
  const mode = org.config.approvalMode;
  const owned = ownedSessions(deps, org, tickets);
  for (const row of [...owned.desks, ...owned.tickets.map((t) => t.row)]) {
    if ((row.archivedAt ?? null) !== null || row.approvalMode === mode) continue;
    deps.sessions.updateApprovalMode(row.sessionId, mode);
  }
}

/**
 * An employee's company plugins, brought up to the library's version.
 *
 * An Agent's plugins are written once, at creation, and nothing rewrites them afterwards —
 * the Agents page offers a manual per-Agent update, which nobody is there to click in an
 * organization that runs unattended for weeks. So every pass compares each employee's
 * installed {@link DEFAULT_EMPLOYEE_PLUGINS} against the library's version and reinstalls
 * the ones that have fallen behind (the same whole-plugin update the Agents page performs),
 * which is how a skill added to `agent-company` after a hire reaches the employees already
 * at work.
 *
 * Cheap when nothing moved: the versions match and no file is written. An employee that does
 * not carry a plugin at all is left alone — the set an Agent was hired with is the CEO's
 * choice, not something a pass grows. A failed update is recorded and never stops the pass:
 * the next one tries again.
 */
async function reconcileEmployeePlugins(deps: OrgDeps, org: LoadedOrg): Promise<void> {
  for (const employee of org.chart.employees) {
    for (const plugin of DEFAULT_EMPLOYEE_PLUGINS) {
      try {
        const { installed, library } = await deps.agents.pluginVersion(
          org.projectId,
          employee.agentId,
          plugin,
        );
        if (installed === null || library === null) continue;
        if (comparePluginVersions(library, installed) <= 0) continue;
        await deps.agents.updatePlugin(org.projectId, employee.agentId, plugin);
        deps.log?.(
          `org: updated plugin ${plugin} on ${employee.agentId} (${installed} -> ${library})`,
        );
      } catch (err) {
        recordError(
          deps,
          org,
          "org_plugin_update_failed",
          `Could not update plugin ${plugin} on ${employee.agentId}: ${err instanceof Error ? err.message : String(err)}`,
          employee.agentId,
        );
      }
    }
  }
}

/**
 * Every employee of the chart has a desk session, and one that went missing comes back.
 *
 * A hire opens the desk itself, so this step is what covers everything hiring does not: an
 * employee added to `org_chart.yaml` by hand, one hired before desks were opened at hire
 * time, and a desk whose session row is gone — deleted by hand, or with the employee's Agent.
 * Until it runs, every surface that addresses a desk by Session id points at a Session the
 * server cannot find: the sidebar's desk row still draws its menu, and binding it to a
 * messaging bot answers "Session does not exist".
 *
 * Opening a desk starts no run, so a paused organization and a switched-off master switch
 * provision desks exactly like an active one. Idempotent: an employee whose desk is there is
 * skipped without a write. A failure is recorded per employee and never stops the pass — the
 * next one tries again.
 */
async function provisionMissingDesks(deps: OrgDeps, org: LoadedOrg): Promise<void> {
  for (const employee of org.chart.employees) {
    const desk = org.desks[employee.agentId];
    if (desk !== undefined && deps.sessions.findById(desk.sessionId) !== null) continue;
    const r = await ensureDesk(deps, org, employee.agentId);
    if (!r.ok) {
      recordError(deps, org, "org_desk_unavailable", r.error, employee.agentId);
      continue;
    }
    if (r.desk.created) {
      deps.log?.(`org: opened a desk session for ${employee.agentId} (${r.desk.sessionId})`);
    }
  }
}

/** The CEO moved an employee's workspace: a desk whose session sits elsewhere is renewed. */
async function renewMovedDesks(deps: OrgDeps, org: LoadedOrg): Promise<void> {
  for (const [agentId, desk] of Object.entries(org.desks)) {
    const employee = org.byId.get(agentId);
    if (!employee) continue;
    const resolved = await deps.store.resolveWorkspace(sharedWorkspace(org), employee.workspace);
    if (resolved === null || resolved === desk.workspace) continue;
    const r = await ensureDesk(deps, org, agentId);
    if (!r.ok) recordError(deps, org, "org_desk_unavailable", r.error, agentId);
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

async function reconcileCalendar(
  deps: OrgDeps,
  org: LoadedOrg,
  tickets: readonly LoadedTicket[],
  spend: OrgSpend,
  paused: Set<string>,
  triggers: boolean,
): Promise<void> {
  const files = await deps.store.listCalendar(org.dir);
  const present: Array<{ agentId: string; name: string }> = [];
  const nowMs = nowOf(deps);
  for (const file of files) {
    present.push({ agentId: file.agentId, name: file.name });
    if (!file.parsed.ok) {
      recordError(
        deps,
        org,
        "org_calendar_invalid",
        `Invalid calendar event ${file.agentId}/${file.name}.toml: ${file.parsed.error}`,
        file.agentId,
      );
      continue;
    }
    if (!org.byId.has(file.agentId)) {
      recordError(
        deps,
        org,
        "org_calendar_invalid",
        `Calendar event ${file.agentId}/${file.name}.toml belongs to no employee`,
        file.agentId,
      );
      continue;
    }
    const def = file.parsed.value;
    const key = {
      projectId: org.projectId,
      orgId: org.orgId,
      agentId: file.agentId,
      name: file.name,
    };
    const { row, fresh } = deps.cache.registerCalendar({
      ...key,
      startAtMs: def.startAtMs,
      defHash: createHash("sha1").update(file.raw).digest("hex"),
    });
    let state = row;
    if (fresh) {
      // No backfill: a due time already in the past at registration is consumed, not fired.
      const slot = latestSlotAt(def, nowMs);
      if (slot !== null) {
        if (def.periodMs === undefined)
          deps.cache.markCalendarMissed(key.projectId, key.orgId, key.agentId, key.name);
        else deps.cache.markCalendarSlot(key.projectId, key.orgId, key.agentId, key.name, slot);
        state = deps.cache.findCalendar(key.projectId, key.orgId, key.agentId, key.name) ?? row;
      }
    }
    if (!def.enabled || state.invalidReason !== null) continue;
    if (def.periodMs === undefined && (state.firedOnce || state.missed)) continue;
    const slot = latestSlotAt(def, nowMs);
    if (slot === null || !slotInWindow(def, slot)) continue;
    if (state.lastSlotMs !== null && slot <= state.lastSlotMs) continue;
    // Consume the slot first: whatever happens next, it is never retried (the twin of no-backfill).
    deps.cache.markCalendarSlot(key.projectId, key.orgId, key.agentId, key.name, slot);
    const mark = (outcome: OrgCalendarOutcome): void =>
      deps.cache.markCalendarOutcome(key.projectId, key.orgId, key.agentId, key.name, outcome);
    if (!triggers || org.config.status === "paused" || paused.has(file.agentId)) {
      mark("paused");
      continue;
    }
    const firedAt = new Date(nowMs).toISOString();
    // The sweep is where ticket changes are delivered: taken here, at the last moment before
    // the run that carries them, so a slot held for a paused employee keeps its queue.
    const notices = deps.cache.takeDeskNotices(org.projectId, org.orgId, file.agentId);
    const digest = deskDigest(notices, tickets);
    const outcome = await dispatchToDesk(
      deps,
      org,
      file.agentId,
      { kind: "event", event: file.name, firedAt },
      digest === "" ? def.prompt : `${def.prompt}\n\n${digest}`,
      { hop: 0, budget: budgetLine(org, spend, file.agentId) },
    );
    if (outcome === "skipped") {
      // The run never started (no desk, or the Task could not be queued): the changes go
      // back on the queue in their order, so the slot that does fire still carries them.
      for (const row of notices) deps.cache.queueDeskNotice(row);
      mark("error");
      continue;
    }
    deps.cache.markCalendarFired(
      key.projectId,
      key.orgId,
      key.agentId,
      key.name,
      firedAt,
      def.periodMs === undefined,
    );
    mark(outcome === "queued" ? "queued" : "fired");
  }
  deps.cache.deleteMissingCalendar(org.projectId, org.orgId, present);
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * One ticket change, queued for the employees it concerns. A change never starts a work run
 * and it never writes into a channel: the employees' half is a row per (employee, ticket,
 * change) that the employee's next calendar sweep carries under "Since your last sweep" —
 * queued whether or not the organization is paused, since delivery waits for that sweep
 * anyway. The people's half is the `org_ticket` event and the overview's inbox, both read
 * from the board itself; a channel is for what people and employees say to each other, and a
 * board that narrates itself into the all-hands channel buries that.
 */
function notifyTicket(
  deps: OrgDeps,
  org: LoadedOrg,
  t: LoadedTicket,
  change: OrgTicketChange,
  agentIds: Iterable<string>,
): void {
  const at = new Date(nowOf(deps)).toISOString();
  for (const agentId of new Set(agentIds)) {
    if (!org.byId.has(agentId)) continue;
    deps.cache.queueDeskNotice({
      projectId: org.projectId,
      orgId: org.orgId,
      agentId,
      ticketId: t.ticketId,
      change,
      at,
    });
  }
}

async function reconcileTickets(
  deps: OrgDeps,
  org: LoadedOrg,
  tickets: readonly LoadedTicket[],
): Promise<void> {
  for (const t of tickets) {
    const cur = {
      projectId: org.projectId,
      orgId: org.orgId,
      ticketId: t.ticketId,
      status: t.doc.status,
      owner: t.doc.owner,
      blocked: t.doc.blocked ?? "",
      blockedBy: t.doc.blockedBy ?? "",
    };
    const prev = deps.cache.findTicketState(org.projectId, org.orgId, t.ticketId);
    if (!prev) {
      // First sight: remember the ticket as it is, notify nothing (the same no-backfill rule as a calendar slot).
      deps.cache.upsertTicketState(cur);
      continue;
    }
    if (
      prev.status === cur.status &&
      prev.owner === cur.owner &&
      prev.blocked === cur.blocked &&
      prev.blockedBy === cur.blockedBy
    ) {
      continue;
    }
    deps.cache.upsertTicketState(cur);
    const events: string[] = [];
    if (prev.status !== cur.status) events.push(`status:${cur.status}`);
    if (prev.owner !== cur.owner) events.push("owner");
    if (prev.blocked !== cur.blocked) events.push(cur.blocked === "" ? "unblocked" : "blocked");
    for (const change of events) {
      deps.notifyProject(org.projectId, {
        type: "org_ticket",
        projectId: org.projectId,
        orgId: org.orgId,
        ticketId: t.ticketId,
        change,
      });
    }
    const ownerAgent = cur.owner === "" ? null : principalAgentId(cur.owner);
    if (prev.owner !== cur.owner && ownerAgent !== null) {
      notifyTicket(deps, org, t, "assigned", [ownerAgent]);
    }
    if (prev.blocked === "" && cur.blocked !== "") {
      const agents: string[] = [];
      const by = parsePrincipal(cur.blockedBy);
      if (by?.kind === "agent") agents.push(by.id);
      const manager = ownerAgent !== null ? (org.byId.get(ownerAgent)?.reportsTo ?? null) : null;
      if (manager !== null) agents.push(manager);
      notifyTicket(deps, org, t, "blocked", agents);
    }
    if (prev.status !== cur.status && (cur.status === "done" || cur.status === "rejected")) {
      // An employee owner hears about its own ticket in its next sweep; a person reads the
      // closure on the board and in the overview's inbox.
      const agents: string[] = [];
      for (const p of new Set([...t.doc.notify, t.doc.owner])) {
        const parsed = parsePrincipal(p);
        if (parsed?.kind === "agent") agents.push(parsed.id);
      }
      notifyTicket(deps, org, t, cur.status, agents);
      // Tickets waiting on this one: their owners are told in their own next sweep, which is
      // where they decide whether to verify and unblock.
      for (const waiting of tickets) {
        if (waiting.doc.blockedBy !== t.ticketId) continue;
        const waitingOwner = principalAgentId(waiting.doc.owner);
        if (waitingOwner !== null) {
          notifyTicket(deps, org, waiting, "blocker_closed", [waitingOwner]);
        }
      }
    }
  }
  deps.cache.deleteMissingTicketState(
    org.projectId,
    org.orgId,
    tickets.map((t) => t.ticketId),
  );
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, "0");

let lastIdMs = 0;
let idSeq = 0;

/**
 * `msg-<UTC time to the second>-<8 hex>`: the suffix packs the millisecond and a per-process
 * sequence, so ids written by this server sort in write order even within one second — the
 * read cursor and the unread count compare ids as strings.
 */
export function newMessageId(nowMs: number): string {
  if (nowMs === lastIdMs) idSeq++;
  else {
    lastIdMs = nowMs;
    idSeq = 0;
  }
  const d = new Date(nowMs);
  const suffix = (((nowMs % 1000) << 12) | (idSeq & 0xfff)).toString(16).padStart(8, "0");
  return `msg-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}-${suffix}`;
}

/** Appends a message to a channel's file for today (organization timezone) and returns it; delivery happens in the scan. */
export async function appendChannelMessage(
  deps: OrgDeps,
  org: LoadedOrg,
  channelId: string,
  msg: Omit<OrgChannelMessage, "id" | "time">,
): Promise<OrgChannelMessage> {
  const nowMs = nowOf(deps);
  const full: OrgChannelMessage = {
    id: newMessageId(nowMs),
    time: new Date(nowMs).toISOString(),
    ...msg,
  };
  await deps.store.appendMessageLine(
    org.dir,
    channelId,
    zonedDate(org.config.timezone, nowMs),
    serializeChannelMessageLine(full),
  );
  return full;
}

/**
 * A `system` line. Organization-wide notices (budgets, ticket notices addressed to people,
 * hires and departures) go to the all-hands channel; a membership notice goes to the
 * channel it concerns. The line arrives as its builder made it — the English sentence and
 * the structured notice beside it — so a client can render it in the reader's language.
 */
export async function appendSystemMessage(
  deps: OrgDeps,
  org: LoadedOrg,
  channelId: string,
  line: SystemLine,
  mentions: string[],
  refs?: OrgChannelMessage["refs"],
): Promise<OrgChannelMessage> {
  return appendChannelMessage(deps, org, channelId, {
    ...systemMessage(line),
    mentions,
    ...(refs !== undefined ? { refs } : {}),
  });
}

/** The body of a mention trigger: the message, then up to 20 earlier messages of that channel's day as context. */
function mentionBody(all: readonly OrgChannelMessage[], msg: OrgChannelMessage): string {
  const idx = all.findIndex((m) => m.id === msg.id);
  const earlier = (idx > 0 ? all.slice(Math.max(0, idx - 20), idx) : []).map(
    (m) => `> ${m.time} ${m.sender}: ${m.text.replace(/\n/g, "\n> ")}`,
  );
  const head = `Message ${msg.id} from ${msg.sender}${msg.refs?.ticket !== undefined ? ` (ticket ${msg.refs.ticket})` : ""}:\n${msg.text}`;
  return earlier.length === 0 ? head : `${head}\n\nEarlier today:\n${earlier.join("\n")}`;
}

/**
 * The employees a channel delivers to: every employee for the all-hands channel, the
 * `agent:` members for any other. An `agent:` member who has since left the organization is
 * not one — the chart decides who exists.
 */
function channelAgents(org: LoadedOrg, channel: ChannelConfig): Set<string> {
  if (channel.everyone === true) return new Set(org.chart.employees.map((e) => e.agentId));
  const out = new Set<string>();
  for (const m of channel.members ?? []) {
    const id = principalAgentId(m);
    if (id !== null && org.byId.has(id)) out.add(id);
  }
  return out;
}

/**
 * Tail-scans each channel's recent day files, publishes every new message and delivers its
 * mentions inside that channel's membership. Archived channels take no posts, so there is
 * nothing new to find in them; an invalid `channel.toml` is reported and the channel skipped.
 */
export async function scanChannels(
  deps: OrgDeps,
  org: LoadedOrg,
  spend: OrgSpend,
  triggers: boolean,
): Promise<void> {
  for (const file of await deps.store.listChannels(org.dir)) {
    if (!file.parsed.ok) {
      recordError(
        deps,
        org,
        "org_channel_invalid",
        `Invalid channel ${file.channelId}/channel.toml: ${file.parsed.error}`,
      );
      continue;
    }
    const channel = file.parsed.value;
    if (channel.archived) continue;
    const members = channelAgents(org, channel);
    const channelId = file.channelId;
    const days = (await deps.store.listMessageDays(org.dir, channelId)).slice(0, 3);
    for (const date of days.reverse()) {
      const offset = deps.cache.channelOffset(org.projectId, org.orgId, channelId, date);
      const { lines, nextOffset } = await deps.store.readMessagesFrom(
        org.dir,
        channelId,
        date,
        offset,
      );
      if (lines.length === 0) {
        if (nextOffset !== offset)
          deps.cache.setChannelOffset(org.projectId, org.orgId, channelId, date, nextOffset);
        continue;
      }
      const all = (await deps.store.readMessageDay(org.dir, channelId, date)).messages;
      for (const line of lines) {
        const parsed = parseChannelMessageLine(line);
        if (!parsed.ok) {
          recordError(
            deps,
            org,
            "org_channel_message_invalid",
            `Invalid message line in ${channelId}/${date}.jsonl: ${parsed.error}`,
          );
          continue;
        }
        const msg = parsed.value;
        deps.notifyProject(org.projectId, {
          type: "org_channel",
          projectId: org.projectId,
          orgId: org.orgId,
          channelId,
          message: msg,
        });
        if (!triggers || org.config.status === "paused" || msg.sender === "system") continue;
        if (msg.hop >= org.config.mentionChainLimit) continue;
        const senderAgent = principalAgentId(msg.sender);
        const targets = new Set<string>();
        for (const m of msg.mentions) {
          const p = parsePrincipal(m);
          // A mention only reaches a member: the send path refuses the rest, and a
          // hand-written line naming an outsider must not deliver either.
          if (p?.kind === "agent") {
            if (members.has(p.id)) targets.add(p.id);
          } else if (p?.kind === "all") {
            for (const id of members) targets.add(id);
          }
        }
        if (senderAgent !== null) targets.delete(senderAgent);
        for (const agentId of targets) {
          if (!org.byId.has(agentId)) continue;
          await dispatchToDesk(
            deps,
            org,
            agentId,
            {
              kind: "mention",
              message: `${msg.id} from ${msg.sender}`,
              channel: channelId,
            },
            mentionBody(all, msg),
            { hop: msg.hop, budget: budgetLine(org, spend, agentId) },
          );
        }
      }
      deps.cache.setChannelOffset(org.projectId, org.orgId, channelId, date, nextOffset);
    }
  }
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

async function reconcileBudgets(deps: OrgDeps, org: LoadedOrg, spend: OrgSpend): Promise<void> {
  const nowIso = new Date(nowOf(deps)).toISOString();
  for (const e of org.chart.employees) {
    if (e.budget === undefined) continue;
    const cost = spend.cumulative.get(e.agentId) ?? 0;
    // A zero budget is spent the moment it is written — everything is already over it — so it
    // reads 100% whatever the cost, the figure `budgetLine` already puts in the trigger block.
    const ratio = e.budget > 0 ? cost / e.budget : 1;
    const state = deps.cache.budgetState(org.projectId, org.orgId, e.agentId, spend.period);
    const notify = (state: "warned" | "paused" | "resumed"): void =>
      deps.notifyProject(org.projectId, {
        type: "org_budget",
        projectId: org.projectId,
        orgId: org.orgId,
        agentId: e.agentId,
        state,
        ratio,
      });
    const pct = Math.round(ratio * 100);
    if (ratio >= org.config.budgetPauseRatio) {
      if (state?.pausedAt === undefined || state.pausedAt === null) {
        deps.cache.markBudget(org.projectId, org.orgId, e.agentId, spend.period, {
          pausedAt: nowIso,
        });
        await appendSystemMessage(
          deps,
          org,
          DEFAULT_CHANNEL_ID,
          budgetPaused({
            agent: agentPrincipal(e.agentId),
            period: spend.period,
            percent: pct,
            cost,
            budget: e.budget,
          }),
          [],
        );
        notify("paused");
      }
    } else if (state?.pausedAt !== undefined && state.pausedAt !== null) {
      deps.cache.markBudget(org.projectId, org.orgId, e.agentId, spend.period, { pausedAt: null });
      notify("resumed");
    }
    if (
      ratio >= org.config.budgetWarnRatio &&
      (state?.warnedAt === undefined || state.warnedAt === null)
    ) {
      deps.cache.markBudget(org.projectId, org.orgId, e.agentId, spend.period, {
        warnedAt: nowIso,
      });
      await appendSystemMessage(
        deps,
        org,
        DEFAULT_CHANNEL_ID,
        budgetWarned({
          agent: agentPrincipal(e.agentId),
          period: spend.period,
          percent: pct,
          cost,
          budget: e.budget,
        }),
        [],
      );
      notify("warned");
    }
  }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  org: LoadedOrg;
  tickets: LoadedTicket[];
  spend: OrgSpend;
}

/**
 * Reconciles one organization. `triggers: false` keeps the pass to caches, desks and
 * budgets (the master switch is off, or a route only needs the projections refreshed).
 */
export async function reconcileOrg(
  deps: OrgDeps,
  projectId: string,
  orgId: string,
  opts: { triggers?: boolean } = {},
): Promise<ReconcileResult | null> {
  const org = await loadOrg(deps, projectId, orgId);
  if (org === null) return null;
  const triggers = opts.triggers ?? true;
  if (org.invalid !== undefined) {
    recordError(deps, org, "org_invalid", `Organization ${orgId} is invalid: ${org.invalid}`);
    const { tickets } = await listTickets(deps, org);
    const spend = await computeSpend(deps, org, tickets);
    return { org, tickets, spend };
  }
  const { tickets } = await listTickets(deps, org);
  syncCaches(deps, org, tickets);
  await reconcileEmployeePlugins(deps, org);
  await provisionMissingDesks(deps, org);
  await renewMovedDesks(deps, org);
  const spend = await computeSpend(deps, org, tickets);
  await reconcileBudgets(deps, org, spend);
  const paused = pausedEmployees(deps, org, spend.period);
  await reconcileCalendar(deps, org, tickets, spend, paused, triggers);
  await reconcileTickets(deps, org, tickets);
  await scanChannels(deps, org, spend, triggers);
  return { org, tickets, spend };
}
