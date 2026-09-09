import fs from "node:fs/promises";
import path from "node:path";
/**
 * The organization service: what the routes (and through them the CLI and the Web App)
 * call. Every write is a validated edit of an organization file under the organization's
 * lock, followed by an immediate reconcile pass so the change takes effect now; every
 * read is a projection of the files plus the live session state and the period's spend.
 */
import type {
  OrgCalendarItem,
  OrgCalendarResponse,
  OrgCalendarUpsertRequest,
  OrgCalendarWriteResponse,
  SemanticIdSuggestRequest,
  SemanticIdSuggestResponse,
  OrgChannelCreateRequest,
  OrgChannelDetail,
  OrgChannelItem,
  OrgChannelMember,
  OrgChannelPatchRequest,
  OrgChannelsResponse,
  OrgChannelMessage,
  OrgChannelMessageSendRequest,
  OrgChannelMessagesResponse,
  OrgChartResponse,
  OrgDeskResponse,
  OrgEmployeeItem,
  OrgEmployeePatchRequest,
  OrgFinanceResponse,
  OrgHireRequest,
  OrgInbox,
  OrgSessionsResponse,
  OrgTicketCreateRequest,
  OrgTicketDetail,
  OrgTicketItem,
  OrgTicketSessionItem,
  OrgTicketStatus,
  OrgTicketUpdateRequest,
  OrgTicketsResponse,
  OrganizationCreateRequest,
  OrganizationDetail,
  OrganizationPatchRequest,
  OrganizationSettings,
  OrganizationSummary,
  OrgLanguage,
  ScheduleStatus,
  OrgHandbookFileResponse,
  OrgHandbookFilesResponse,
} from "../../api/types.js";
import { HttpError } from "../../http/errors.js";
import { badRequest } from "../../http/validate.js";
import type { ChannelConfig, OrgConfig, OrgEmployee, TicketDoc } from "../../organization/files.js";
import {
  DEFAULT_CEO_BUDGET,
  ORG_CONFIG_DEFAULTS,
  TICKET_ID_PATTERN,
  detectLanguage,
  extractMentionTokens,
  orgLanguage,
  parseCalendarEvent,
  parseOrgChart,
  parseProgressLine,
  progressLine,
  serializeCalendarEvent,
  serializeOrgChart,
  slugify,
} from "../../organization/files.js";
import { renderHandbook } from "../../organization/handbook.js";
import {
  DEFAULT_CHANNEL_ID,
  ORG_TICKET_COLUMNS,
  ceoAgentId,
  isChannelId,
  isHandbookFilePath,
  isTicketColumn,
  normalizeWorkspaceSpec,
} from "../../organization/paths.js";
import {
  agentPrincipal,
  parsePrincipal,
  principalAgentId,
  userPrincipal,
} from "../../organization/principal.js";
import { isValidTimeZone, zonedDate, zonedDayRange } from "../../organization/zoned.js";
import { fallbackSemanticId, sanitizeSuggestedId } from "../../organization/semantic-id.js";
import { SEMANTIC_ID_PATTERN } from "../../services/ids.js";
import { latestSlotAt, nextSlotAfter, slotInWindow } from "../schedule-file.js";
import type { ScheduleDefinition } from "../schedule-file.js";
import { budgetLine, computeSpend, pausedEmployees } from "./budget.js";
import type { OrgSpend } from "./budget.js";
import type { OrgDeps } from "./deps.js";
import { loadOrg, sharedWorkspace } from "./model.js";
import type { LoadedOrg } from "./model.js";
import {
  channelArchiveChanged,
  channelCreated,
  channelMemberAdded,
  channelMemberRemoved,
  employeeJoined,
  employeeLeft,
  systemMessage,
} from "./notices.js";
import { appendChannelMessage, listTickets, syncCaches } from "./reconcile.js";
import type { LoadedTicket } from "./reconcile.js";
import { rotaWarnings } from "./rota.js";
import type { OrganizationScheduler } from "./scheduler.js";
import { dispatchToDesk, ensureDesk, openTicketSession } from "./triggers.js";

export const DEFAULT_EMPLOYEE_PLUGINS = ["agent-company", "agent-development"] as const;

/** Who performs a write: a person (route user) or, through the control-env token from inside a session, that session's employee. */
export interface Actor {
  userId: string;
  sessionId?: string;
}

const notFound = (orgId: string): HttpError =>
  new HttpError(404, "org_not_found", `Organization does not exist: ${orgId}`);

const ticketNotFound = (ticketId: string): HttpError =>
  new HttpError(404, "ticket_not_found", `Ticket does not exist: ${ticketId}`);

const channelNotFound = (channelId: string): HttpError =>
  new HttpError(404, "channel_not_found", `Channel does not exist: ${channelId}`);

const channelArchived = (channelId: string): HttpError =>
  new HttpError(
    409,
    "channel_archived",
    `Channel ${channelId} is archived: unarchive it before writing to it.`,
  );

const notAMember = (channelId: string, principal: string, why?: string): HttpError =>
  new HttpError(
    403,
    "not_a_member",
    why ?? `${principal} is not a member of the channel ${channelId}.`,
  );

const allHandsImmutable = (message: string): HttpError =>
  new HttpError(400, "all_hands_immutable", message);

export class OrganizationService {
  constructor(
    private readonly deps: OrgDeps,
    private readonly scheduler: OrganizationScheduler,
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The organization a session belongs to, for the `PENGUIN_ORG_ID` control variable. */
  orgIdOfSession(sessionId: string): string | null {
    return this.deps.cache.ownerOfSession(sessionId)?.orgId ?? null;
  }

  /**
   * A semantic id for a display name (the organization and channel dialogs name the thing
   * first and derive the id). The Project's default model translates the name into one
   * snake_case English identifier — the common case is a Chinese name, which nothing
   * mechanical can transliterate — and the ASCII slug of the name answers whenever the model
   * is unavailable, refuses or answers with something no id can be built from. A name that
   * neither path can name is a 422: the dialog then asks for an id by hand.
   */
  async suggestId(
    projectId: string,
    req: SemanticIdSuggestRequest,
  ): Promise<SemanticIdSuggestResponse> {
    const taken = req.taken ?? [];
    if (this.deps.completeOnce !== undefined) {
      const answer = await this.deps.completeOnce(projectId, semanticIdPrompt(req));
      const id = answer === null ? null : sanitizeSuggestedId(answer, req.kind, taken);
      if (id !== null) return { id, source: "model" };
    }
    const id = fallbackSemanticId(req.name, req.kind, taken);
    if (id === null) {
      throw new HttpError(
        422,
        "id_not_derivable",
        "No id can be derived from this name; type one by hand.",
      );
    }
    return { id, source: "fallback" };
  }

  private async requireOrg(projectId: string, orgId: string): Promise<LoadedOrg> {
    const org = await loadOrg(this.deps, projectId, orgId);
    if (org === null) throw notFound(orgId);
    return org;
  }

  /** A write that needs the chart: an invalid organization is repaired by editing its files, not through the API. */
  private async requireValidOrg(projectId: string, orgId: string): Promise<LoadedOrg> {
    const org = await this.requireOrg(projectId, orgId);
    if (org.invalid !== undefined) {
      throw new HttpError(409, "org_invalid", `Organization ${orgId} needs repair: ${org.invalid}`);
    }
    return org;
  }

  /** `agent:<id>` when the write comes from a session of this organization, else `user:<id>`. */
  private actorPrincipal(org: LoadedOrg, actor: Actor): string {
    if (actor.sessionId !== undefined) {
      const owner = this.deps.cache.ownerOfSession(actor.sessionId);
      if (owner && owner.projectId === org.projectId && owner.orgId === org.orgId) {
        return agentPrincipal(owner.agentId);
      }
      const row = this.deps.sessions.findById(actor.sessionId);
      if (row && row.projectId === org.projectId && org.byId.has(row.agentId))
        return agentPrincipal(row.agentId);
    }
    return userPrincipal(actor.userId);
  }

  /**
   * The employee an actor writes as, or null when it writes as a person. The one question
   * the ticket-start rule asks: a desk or ticket session names its employee, everything else
   * — the Web App, a signed-in CLI outside a session — is a person of the Project.
   */
  private actorEmployee(org: LoadedOrg, actor: Actor): string | null {
    return principalAgentId(this.actorPrincipal(org, actor));
  }

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  async list(projectId: string): Promise<OrganizationSummary[]> {
    const out: OrganizationSummary[] = [];
    for (const orgId of await this.deps.store.listOrgIds(projectId)) {
      const org = await loadOrg(this.deps, projectId, orgId);
      if (org === null) continue;
      const { tickets } = await listTickets(this.deps, org);
      const spend = await computeSpend(this.deps, org, tickets);
      out.push(this.summary(org, tickets, spend));
    }
    return out;
  }

  private summary(
    org: LoadedOrg,
    tickets: readonly LoadedTicket[],
    spend: OrgSpend,
  ): OrganizationSummary {
    const paused = pausedEmployees(this.deps, org, spend.period);
    let running = 0;
    for (const e of org.chart.employees) if (this.employeeRunning(org, e.agentId)) running++;
    const ceo = ceoAgentId(org.orgId);
    const ceoBudget = org.byId.get(ceo)?.budget;
    const cost = spend.cumulative.get(ceo) ?? 0;
    return {
      projectId: org.projectId,
      orgId: org.orgId,
      name: org.config.name,
      mission: org.config.mission,
      status: org.config.status,
      employeeCount: org.chart.employees.length,
      runningCount: running,
      pausedCount: paused.size,
      openTickets: tickets.filter((t) => t.column !== "done" && t.column !== "rejected").length,
      blockedTickets: tickets.filter((t) => t.doc.blocked !== undefined && t.doc.blocked !== "")
        .length,
      createdBy: org.config.createdBy,
      spend: {
        period: spend.period,
        cost,
        ...(ceoBudget !== undefined ? { budget: ceoBudget } : {}),
        ...(ceoBudget !== undefined && ceoBudget > 0 ? { ratio: cost / ceoBudget } : {}),
      },
      ...(org.invalid !== undefined ? { invalid: org.invalid } : {}),
    };
  }

  private employeeRunning(org: LoadedOrg, agentId: string): boolean {
    const desk = org.desks[agentId];
    if (desk && this.deps.runner.statusOf(desk.sessionId) !== "idle") return true;
    for (const row of this.deps.cache.ticketSessions(org.projectId, org.orgId)) {
      if (row.agentId === agentId && this.deps.runner.statusOf(row.sessionId) !== "idle")
        return true;
    }
    return false;
  }

  private settings(org: LoadedOrg): OrganizationSettings {
    return {
      name: org.config.name,
      mission: org.config.mission,
      status: org.config.status,
      timezone: org.config.timezone,
      approvalMode: org.config.approvalMode,
      mentionChainLimit: org.config.mentionChainLimit,
      budgetWarnRatio: org.config.budgetWarnRatio,
      budgetPauseRatio: org.config.budgetPauseRatio,
      createdBy: org.config.createdBy,
      // Always the effective language, never the raw field: an organization written before
      // the field existed still has one, read from its mission.
      language: orgLanguage(org.config),
      ...(org.config.workspace !== undefined ? { workspace: org.config.workspace } : {}),
      ...(org.config.model !== undefined ? { model: org.config.model } : {}),
    };
  }

  /** A shared-workspace root chosen by the user: absolute and an existing directory. */
  private async requireWorkspaceDir(spec: string): Promise<string> {
    if (!path.isAbsolute(spec)) throw badRequest("workspace must be an absolute path.");
    const real = await fs.stat(spec).then(
      (s) => (s.isDirectory() ? spec : null),
      () => null,
    );
    if (real === null) throw badRequest(`workspace directory does not exist: ${spec}`);
    return real;
  }

  async detail(projectId: string, orgId: string, userId: string): Promise<OrganizationDetail> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    const summary = this.summary(org, tickets, spend);
    const board = Object.fromEntries(ORG_TICKET_COLUMNS.map((c) => [c, 0])) as Record<
      OrgTicketStatus,
      number
    >;
    for (const t of tickets) board[t.column]++;
    const nowMs = this.now();
    const todayDate = zonedDate(org.config.timezone, nowMs);
    const day = zonedDayRange(org.config.timezone, todayDate);
    const calendar = await this.calendarItems(org, spend);
    const today = calendar.events.filter((e) => {
      const inDay = (iso: string | undefined): boolean => {
        if (iso === undefined) return false;
        const ms = Date.parse(iso);
        return ms >= day.fromMs && ms < day.toMs;
      };
      return inDay(e.nextFireAt) || inDay(e.lastFiredAt);
    });
    // The overview opens even when the all-hands channel's file is missing or unreadable (a
    // hand edit): it then reports no recent messages instead of refusing the page.
    const allHands = await this.deps.store.readChannel(org.dir, DEFAULT_CHANNEL_ID);
    const recent =
      allHands?.parsed.ok === true
        ? await this.channelMessages(projectId, orgId, { userId }, DEFAULT_CHANNEL_ID, {})
        : null;
    const mentions = await this.pendingMentions(org, userId);
    const me = userPrincipal(userId);
    const items = this.ticketItems(tickets, spend);
    const ceoDesk = org.desks[ceoAgentId(orgId)];
    return {
      ...summary,
      settings: this.settings(org),
      board,
      today,
      pending: {
        mentions,
        reviewTickets: items.filter((t) => t.status === "review"),
        blockedByMe: items.filter((t) => t.blockedBy === me),
      },
      recentMessages: recent?.messages.slice(-20) ?? [],
      inbox: this.inbox(spend, items, tickets, recent?.messages ?? [], me),
      alerts: this.alerts(org, spend.period),
      ...(ceoDesk !== undefined ? { ceoDeskSessionId: ceoDesk.sessionId } : {}),
    };
  }

  /**
   * The overview's inbox — what a person is waited on or told about, read from the same
   * files `detail` already loaded:
   *
   * - `mentions`: the all-hands messages of the window `recentMessages` reads (the
   *   organization's current day) that name the caller or `all`, newest first.
   * - `blockedTickets`: every ticket carrying a `Blocked` reason, whoever it waits on —
   *   uncapped, because a blocked ticket is work nobody is doing.
   * - `doneTickets`: tickets in `done` that closed in the current budget period, `closedAt`
   *   taken from the last progress line that moved them there. A ticket whose file was moved
   *   by hand has no such line and no closing time to test, so it is listed with `closedAt`
   *   absent rather than hidden.
   *
   * Newest first everywhere; ticket ids start with the filing date, so ordering by id
   * descending is ordering by age.
   */
  private inbox(
    spend: OrgSpend,
    items: readonly OrgTicketItem[],
    tickets: readonly LoadedTicket[],
    windowMessages: readonly OrgChannelMessage[],
    me: string,
  ): OrgInbox {
    const mentions = windowMessages
      .filter((m) => m.mentions.includes(me) || m.mentions.includes("all"))
      .reverse()
      .slice(0, INBOX_PAGE);
    const newestFirst = <T extends { ticketId: string }>(a: T, b: T): number =>
      a.ticketId < b.ticketId ? 1 : a.ticketId > b.ticketId ? -1 : 0;
    const closedAt = new Map<string, string>();
    for (const t of tickets) {
      const at = lastClosedAt(t.doc);
      if (at !== null) closedAt.set(t.ticketId, at);
    }
    const inPeriod = (iso: string): boolean => {
      const ms = Date.parse(iso);
      // An unparsable stamp is a hand-edited line, not evidence the ticket closed elsewhen.
      return Number.isNaN(ms) || (ms >= spend.range.fromMs && ms < spend.range.toMs);
    };
    const doneTickets = items
      .filter((t) => t.status === "done")
      .map((t): OrgInbox["doneTickets"][number] => {
        const at = closedAt.get(t.ticketId);
        return { ...t, ...(at !== undefined ? { closedAt: at } : {}) };
      })
      .filter((t) => t.closedAt === undefined || inPeriod(t.closedAt))
      .sort(newestFirst)
      .slice(0, INBOX_PAGE);
    return {
      mentions,
      blockedTickets: items.filter((t) => (t.blocked ?? "") !== "").sort(newestFirst),
      doneTickets,
    };
  }

  /** Mentions waiting for a person, summed over every channel they belong to. */
  private async pendingMentions(org: LoadedOrg, userId: string): Promise<number> {
    const me = userPrincipal(userId);
    let mentions = 0;
    for (const file of await this.deps.store.listChannels(org.dir)) {
      if (!file.parsed.ok) continue;
      if (!this.channelMemberPrincipals(org, file.parsed.value).includes(me)) continue;
      mentions += (await this.channelActivity(org, file.channelId, userId)).mentionsMe;
    }
    return mentions;
  }

  private alerts(org: LoadedOrg, period: string): OrganizationDetail["alerts"] {
    return this.deps.cache
      .listBudgetStates(org.projectId, org.orgId, period)
      .filter((s) => s.warnedAt !== null || s.pausedAt !== null)
      .map((s) => ({
        agentId: s.agentId,
        period: s.period,
        ...(s.warnedAt !== null ? { warnedAt: s.warnedAt } : {}),
        ...(s.pausedAt !== null ? { pausedAt: s.pausedAt } : {}),
      }));
  }

  /**
   * Creates an organization as one whole: directory and files, the CEO Agent (with the
   * company and orchestration plugins and an employee brief), then the initialization work
   * run on the CEO's desk. Any failure removes what was written; a taken CEO id is a 409
   * before anything is touched.
   */
  async create(
    projectId: string,
    req: OrganizationCreateRequest,
    userId: string,
  ): Promise<OrganizationDetail> {
    const orgId = req.orgId;
    if (!SEMANTIC_ID_PATTERN.test(orgId)) {
      throw new HttpError(
        400,
        "invalid_org_id",
        "Organization id must be 2–64 characters: a lowercase letter, then lowercase letters, digits or underscores.",
      );
    }
    const mission = req.mission.trim();
    if (mission === "") throw badRequest("mission must not be empty.");
    const timezone = req.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    if (!isValidTimeZone(timezone)) throw badRequest(`Unknown timezone: ${timezone}`);
    if (await this.deps.store.exists(projectId, orgId)) {
      throw new HttpError(409, "org_exists", `Organization id is already taken: ${orgId}`);
    }
    const ceo = ceoAgentId(orgId);
    if (await this.deps.agents.exists(projectId, ceo)) {
      throw new HttpError(409, "agent_exists", `The CEO's Agent id is already taken: ${ceo}`);
    }
    const name = req.name?.trim() || orgId;
    if (req.model !== undefined) await this.validateModel(projectId, req.model);
    const workspace =
      req.workspace !== undefined ? await this.requireWorkspaceDir(req.workspace) : undefined;
    // The mission decides the working language unless the request names one: a company given
    // a Chinese mission writes in Chinese, without anyone having to ask for it.
    const language = req.language ?? detectLanguage(mission);
    const config: OrgConfig = {
      name,
      mission,
      status: "active",
      timezone,
      language,
      approvalMode: ORG_CONFIG_DEFAULTS.approvalMode,
      mentionChainLimit: ORG_CONFIG_DEFAULTS.mentionChainLimit,
      budgetWarnRatio: ORG_CONFIG_DEFAULTS.budgetWarnRatio,
      budgetPauseRatio: ORG_CONFIG_DEFAULTS.budgetPauseRatio,
      createdBy: userId,
      ...(workspace !== undefined ? { workspace } : {}),
      ...(req.model !== undefined ? { model: req.model } : {}),
    };
    const dir = this.deps.store.dir(projectId, orgId);
    await this.deps.store.createLayout(dir, new Date(this.now()).toISOString());
    try {
      await this.deps.store.writeConfig(dir, config);
      await this.deps.store.writeChart(dir, {
        employees: [
          {
            agentId: ceo,
            title: "CEO",
            reportsTo: null,
            duties:
              language === "zh"
                ? "把使命拆成工单、招募、划分公共工作区、审核工单、向董事会汇报"
                : "Turn the mission into tickets, hire, partition the shared workspace, review tickets, report to the board",
            workspace: ".",
            // Compared on the cumulative line, so this one number is the whole company's cap.
            budget: req.ceoBudget ?? DEFAULT_CEO_BUDGET,
          },
        ],
      });
      await this.deps.store.writeHandbook(
        dir,
        renderHandbook({ orgId, name, mission, ceoAgentId: ceo, createdBy: userId, language }),
      );
      await this.deps.agents.create(
        projectId,
        ceo,
        `${name} CEO`,
        `CEO of ${name}`,
        DEFAULT_EMPLOYEE_PLUGINS,
      );
      await this.deps.agents.writeAgentsMd(
        projectId,
        ceo,
        employeeBrief({
          orgId,
          name,
          mission,
          agentId: ceo,
          title: "CEO",
          reportsTo: null,
          language,
        }),
      );
    } catch (err) {
      await this.deps.store.remove(dir);
      throw err;
    }
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const spend = await computeSpend(this.deps, org, []);
      await dispatchToDesk(this.deps, org, ceo, { kind: "init" }, initBody(org), {
        hop: 0,
        budget: budgetLine(org, spend, ceo),
      });
    });
    await this.scheduler.reconcile(projectId, orgId);
    return this.detail(projectId, orgId, userId);
  }

  async patch(
    projectId: string,
    orgId: string,
    req: OrganizationPatchRequest,
  ): Promise<OrganizationSettings> {
    return this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      // A broken config is rewritten whole from the request over the defaults loadOrg filled in.
      const next: OrgConfig = { ...org.config };
      if (req.name !== undefined) {
        if (req.name.trim() === "") throw badRequest("name must not be empty.");
        next.name = req.name.trim();
      }
      if (req.mission !== undefined) next.mission = req.mission.trim();
      if (req.status !== undefined) next.status = req.status;
      if (req.approvalMode !== undefined) next.approvalMode = req.approvalMode;
      if (req.timezone !== undefined) {
        if (!isValidTimeZone(req.timezone)) throw badRequest(`Unknown timezone: ${req.timezone}`);
        next.timezone = req.timezone;
      }
      if (req.language !== undefined) next.language = req.language;
      if (req.mentionChainLimit !== undefined) next.mentionChainLimit = req.mentionChainLimit;
      if (req.budgetWarnRatio !== undefined) next.budgetWarnRatio = req.budgetWarnRatio;
      if (req.budgetPauseRatio !== undefined) next.budgetPauseRatio = req.budgetPauseRatio;
      if (req.workspace === null) delete next.workspace;
      else if (req.workspace !== undefined)
        next.workspace = await this.requireWorkspaceDir(req.workspace);
      if (req.model === null) delete next.model;
      else if (req.model !== undefined) {
        await this.validateModel(projectId, req.model);
        next.model = req.model;
      }
      await this.deps.store.writeConfig(org.dir, next);
      org.config = next;
      return this.settings(org);
    });
  }

  /** Removes the directory and every cache row; desk and ticket sessions stay as ordinary sessions of their Agents. */
  async remove(projectId: string, orgId: string): Promise<void> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      await this.deps.store.remove(org.dir);
      this.deps.cache.deleteOrg(projectId, orgId);
    });
  }

  // ---------------------------------------------------------------------------
  // Employees, desks, handbook
  // ---------------------------------------------------------------------------

  async chart(projectId: string, orgId: string): Promise<OrgChartResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    return { ceoAgentId: ceoAgentId(orgId), employees: await this.employeeItems(org, spend) };
  }

  private async employeeItems(org: LoadedOrg, spend: OrgSpend): Promise<OrgEmployeeItem[]> {
    const paused = pausedEmployees(this.deps, org, spend.period);
    const out: OrgEmployeeItem[] = [];
    const shared = sharedWorkspace(org);
    for (const e of org.chart.employees) {
      const exists = await this.deps.agents.exists(org.projectId, e.agentId);
      // A relative sub-directory that is not there yet is not a broken entry: it is created
      // when the employee is first put to work. Only a spec that leaves the shared workspace,
      // or an absolute directory nobody created, makes the entry unusable.
      const workspace = this.deps.store.workspaceTarget(shared, e.workspace);
      const absentAbsolute =
        workspace !== null &&
        path.isAbsolute(e.workspace) &&
        (await this.deps.store.resolveWorkspace(shared, e.workspace)) === null;
      const invalid = !exists
        ? `Agent ${e.agentId} does not exist`
        : workspace === null
          ? `workspace leaves the shared workspace: ${e.workspace}`
          : absentAbsolute
            ? `workspace directory does not exist: ${e.workspace}`
            : undefined;
      const own = spend.own.get(e.agentId) ?? 0;
      const cumulative = spend.cumulative.get(e.agentId) ?? 0;
      const desk = org.desks[e.agentId];
      out.push({
        agentId: e.agentId,
        name: exists ? await this.deps.agents.displayName(org.projectId, e.agentId) : e.agentId,
        title: e.title,
        reportsTo: e.reportsTo,
        ...(e.duties !== undefined ? { duties: e.duties } : {}),
        workspace: e.workspace,
        ...(workspace !== null ? { resolvedWorkspace: workspace } : {}),
        ...(e.budget !== undefined ? { budget: e.budget } : {}),
        ...(e.model !== undefined ? { model: e.model } : {}),
        state: paused.has(e.agentId)
          ? "paused"
          : this.employeeRunning(org, e.agentId)
            ? "running"
            : "idle",
        ...(desk !== undefined
          ? {
              desk: {
                sessionId: desk.sessionId,
                workspace: desk.workspace,
                openedAt: desk.openedAt,
              },
            }
          : {}),
        spend: {
          own,
          cumulative,
          ...(e.budget !== undefined && e.budget > 0 ? { ratio: cumulative / e.budget } : {}),
        },
        ...(invalid !== undefined ? { invalid } : {}),
      });
    }
    return out;
  }

  private async validateModel(
    projectId: string,
    model: { provider: string; modelId: string },
  ): Promise<void> {
    const cfg = await this.deps.projectConfig.loadConfig(projectId);
    const known = cfg.models.some(
      (m) => m.provider === model.provider && m.model_id === model.modelId,
    );
    if (!known)
      throw badRequest(
        `Model (${model.provider}, ${model.modelId}) is not configured in this Project.`,
      );
  }

  /**
   * The workspace spec to store for an employee, with its directory ready: `./hr`, `hr/` and
   * `hr` all become `hr`, a relative partition is created under the shared workspace, and an
   * absolute path must already exist because it is a directory of the user's, not ours to
   * make. A spec that climbs out of the shared workspace is refused outright.
   */
  private async requireEmployeeWorkspace(
    org: LoadedOrg,
    spec: string | undefined,
  ): Promise<string> {
    const normalized = normalizeWorkspaceSpec(spec ?? ".");
    const shared = sharedWorkspace(org);
    if (this.deps.store.workspaceTarget(shared, normalized) === null) {
      throw new HttpError(
        400,
        "invalid_workspace",
        `workspace must stay inside the shared workspace: ${normalized}`,
      );
    }
    if ((await this.deps.store.ensureWorkspace(shared, normalized)) === null) {
      throw new HttpError(
        400,
        "invalid_workspace",
        `workspace directory does not exist: ${normalized}`,
      );
    }
    return normalized;
  }

  /** Writes a chart after re-validating it through the parser: the API never persists what a hand edit would be refused for. */
  private async writeChart(org: LoadedOrg, employees: OrgEmployee[]): Promise<void> {
    const raw = serializeOrgChart({ employees });
    const parsed = parseOrgChart(raw, org.orgId);
    if (!parsed.ok) throw badRequest(`Invalid employee tree: ${parsed.error}`);
    await this.deps.store.writeChart(org.dir, parsed.value);
    org.chart = parsed.value;
    org.byId = new Map(parsed.value.employees.map((e) => [e.agentId, e]));
  }

  async hire(projectId: string, orgId: string, req: OrgHireRequest): Promise<OrgEmployeeItem> {
    const item = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const title = req.title.trim();
      if (title === "") throw badRequest("title must not be empty.");
      if (!org.byId.has(req.reportsTo))
        throw badRequest(`reportsTo names no employee: ${req.reportsTo}`);
      if ((req.agentId === undefined) === (req.newAgent === undefined)) {
        throw badRequest(
          "Give exactly one of agentId (an existing Agent) or newAgent (create one).",
        );
      }
      if (req.model !== undefined) await this.validateModel(projectId, req.model);
      // Before the Agent and the chart entry: the partition an employee is hired into exists
      // from the moment the employee does, and a spec that leaves the shared workspace is
      // refused rather than written and found broken on the first trigger.
      const workspace = await this.requireEmployeeWorkspace(org, req.workspace);
      let agentId: string;
      if (req.newAgent !== undefined) {
        agentId = req.newAgent.agentId;
        if (!SEMANTIC_ID_PATTERN.test(agentId))
          throw badRequest("newAgent.agentId is not a valid Agent id.");
        if (org.byId.has(agentId))
          throw new HttpError(409, "employee_exists", `${agentId} is already an employee.`);
        await this.deps.agents.create(
          projectId,
          agentId,
          req.newAgent.name,
          req.newAgent.description,
          req.newAgent.plugins ?? DEFAULT_EMPLOYEE_PLUGINS,
        );
        await this.deps.agents.writeAgentsMd(
          projectId,
          agentId,
          employeeBrief({
            orgId,
            name: org.config.name,
            mission: org.config.mission,
            agentId,
            title,
            reportsTo: req.reportsTo,
            language: orgLanguage(org.config),
            ...(req.duties !== undefined ? { duties: req.duties } : {}),
          }),
        );
      } else {
        agentId = req.agentId!;
        if (!(await this.deps.agents.exists(projectId, agentId))) {
          throw new HttpError(404, "agent_not_found", `Agent does not exist: ${agentId}`);
        }
        if (org.byId.has(agentId))
          throw new HttpError(409, "employee_exists", `${agentId} is already an employee.`);
      }
      const employee: OrgEmployee = {
        agentId,
        title,
        reportsTo: req.reportsTo,
        ...(req.duties !== undefined && req.duties.trim() !== ""
          ? { duties: req.duties.trim() }
          : {}),
        workspace,
        ...(req.budget !== undefined ? { budget: req.budget } : {}),
        ...(req.model !== undefined ? { model: req.model } : {}),
      };
      await this.writeChart(org, [...org.chart.employees, employee]);
      await appendChannelMessage(
        this.deps,
        org,
        DEFAULT_CHANNEL_ID,
        systemMessage(
          employeeJoined(agentPrincipal(agentId), title, agentPrincipal(req.reportsTo)),
        ),
      );
      const spend = await computeSpend(this.deps, org, (await listTickets(this.deps, org)).tickets);
      const items = await this.employeeItems(org, spend);
      return items.find((i) => i.agentId === agentId)!;
    });
    await this.scheduler.reconcile(projectId, orgId);
    return item;
  }

  async patchEmployee(
    projectId: string,
    orgId: string,
    agentId: string,
    req: OrgEmployeePatchRequest,
  ): Promise<OrgEmployeeItem> {
    const item = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const current = org.byId.get(agentId);
      if (!current)
        throw new HttpError(404, "employee_not_found", `${agentId} is not an employee.`);
      if (req.model !== undefined && req.model !== null)
        await this.validateModel(projectId, req.model);
      if (req.reportsTo !== undefined && current.reportsTo === null) {
        throw badRequest("The CEO reports to nobody.");
      }
      const next: OrgEmployee = {
        ...current,
        ...(req.title !== undefined ? { title: req.title.trim() } : {}),
        ...(req.reportsTo !== undefined ? { reportsTo: req.reportsTo } : {}),
        // A reassigned partition is created here, so the desk the next reconcile renews has
        // its directory waiting for it.
        ...(req.workspace !== undefined
          ? { workspace: await this.requireEmployeeWorkspace(org, req.workspace) }
          : {}),
        ...(req.duties !== undefined ? { duties: req.duties.trim() } : {}),
      };
      if (req.budget === null) delete next.budget;
      else if (req.budget !== undefined) next.budget = req.budget;
      if (req.model === null) delete next.model;
      else if (req.model !== undefined) next.model = req.model;
      if (next.duties === "") delete next.duties;
      if (next.title === "") throw badRequest("title must not be empty.");
      await this.writeChart(
        org,
        org.chart.employees.map((e) => (e.agentId === agentId ? next : e)),
      );
      const spend = await computeSpend(this.deps, org, (await listTickets(this.deps, org)).tickets);
      const items = await this.employeeItems(org, spend);
      return items.find((i) => i.agentId === agentId)!;
    });
    await this.scheduler.reconcile(projectId, orgId);
    return item;
  }

  /** Removes the employee from the tree (subordinates move up to its manager); the Agent and its sessions stay. */
  async leave(projectId: string, orgId: string, agentId: string): Promise<void> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const current = org.byId.get(agentId);
      if (!current)
        throw new HttpError(404, "employee_not_found", `${agentId} is not an employee.`);
      if (current.reportsTo === null) throw badRequest("The CEO cannot leave the organization.");
      const manager = current.reportsTo;
      await this.writeChart(
        org,
        org.chart.employees
          .filter((e) => e.agentId !== agentId)
          .map((e) => (e.reportsTo === agentId ? { ...e, reportsTo: manager } : e)),
      );
      if (org.desks[agentId] !== undefined) {
        delete org.desks[agentId];
        await this.deps.store.writeDesks(org.dir, org.desks);
      }
      // Nothing will sweep for this employee again, so its queued ticket changes go with it.
      this.deps.cache.deleteDeskNotices(projectId, orgId, agentId);
      for (const f of await this.deps.store.listCalendar(org.dir)) {
        if (f.agentId === agentId)
          await this.deps.store.deleteCalendarEvent(org.dir, agentId, f.name);
      }
      // A departed employee is nobody's channel member any more: the files say who is in a
      // channel, and a principal that is no longer an employee would be counted and listed.
      for (const file of await this.deps.store.listChannels(org.dir)) {
        if (!file.parsed.ok || file.parsed.value.everyone === true) continue;
        const members = file.parsed.value.members ?? [];
        if (!members.includes(agentPrincipal(agentId))) continue;
        await this.deps.store.writeChannel(org.dir, file.channelId, {
          ...file.parsed.value,
          members: members.filter((m) => m !== agentPrincipal(agentId)),
        });
      }
      await appendChannelMessage(
        this.deps,
        org,
        DEFAULT_CHANNEL_ID,
        systemMessage(employeeLeft(agentPrincipal(agentId), agentPrincipal(manager))),
      );
    });
    await this.scheduler.reconcile(projectId, orgId);
  }

  async desk(
    projectId: string,
    orgId: string,
    agentId: string,
    opts: { renew?: boolean },
  ): Promise<OrgDeskResponse> {
    return this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      if (!org.byId.has(agentId))
        throw new HttpError(404, "employee_not_found", `${agentId} is not an employee.`);
      const r = await ensureDesk(this.deps, org, agentId, opts);
      if (!r.ok) throw new HttpError(409, "desk_unavailable", r.error);
      return { agentId, ...r.desk };
    });
  }

  async handbook(projectId: string, orgId: string): Promise<string> {
    const org = await this.requireOrg(projectId, orgId);
    return this.deps.store.readHandbook(org.dir);
  }

  async writeHandbook(projectId: string, orgId: string, content: string): Promise<void> {
    const org = await this.requireOrg(projectId, orgId);
    await this.deps.store.writeHandbook(org.dir, content);
  }

  /** The handbook directory is the company's knowledge base; the index is listed first. */
  async handbookFiles(projectId: string, orgId: string): Promise<OrgHandbookFilesResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const files = await this.deps.store.listHandbookFiles(org.dir);
    return {
      files: files.map((f) => ({
        path: f.path,
        size: f.size,
        updatedAt: new Date(f.mtimeMs).toISOString(),
      })),
    };
  }

  async handbookFile(
    projectId: string,
    orgId: string,
    rel: string,
  ): Promise<OrgHandbookFileResponse> {
    requireHandbookPath(rel);
    const org = await this.requireOrg(projectId, orgId);
    const content = await this.deps.store.readHandbookFile(org.dir, rel);
    if (content === null)
      throw new HttpError(404, "handbook_file_not_found", `${rel} is not in the handbook.`);
    return { path: rel, content };
  }

  async writeHandbookFile(
    projectId: string,
    orgId: string,
    rel: string,
    content: string,
  ): Promise<OrgHandbookFileResponse> {
    requireHandbookPath(rel);
    const org = await this.requireOrg(projectId, orgId);
    await this.deps.store.writeHandbookFile(org.dir, rel, content);
    return { path: rel, content };
  }

  /** The index stays: it is what every trigger tells the employee to read. */
  async deleteHandbookFile(projectId: string, orgId: string, rel: string): Promise<void> {
    requireHandbookPath(rel);
    if (rel === "README.md")
      throw new HttpError(
        400,
        "handbook_index_required",
        "The handbook index (README.md) cannot be deleted.",
      );
    const org = await this.requireOrg(projectId, orgId);
    if ((await this.deps.store.readHandbookFile(org.dir, rel)) === null)
      throw new HttpError(404, "handbook_file_not_found", `${rel} is not in the handbook.`);
    await this.deps.store.deleteHandbookFile(org.dir, rel);
  }

  // ---------------------------------------------------------------------------
  // Calendar
  // ---------------------------------------------------------------------------

  private async calendarItems(org: LoadedOrg, spend: OrgSpend): Promise<OrgCalendarResponse> {
    const files = await this.deps.store.listCalendar(org.dir);
    const paused = pausedEmployees(this.deps, org, spend.period);
    const nowMs = this.now();
    const events: OrgCalendarItem[] = [];
    const invalidFiles: OrgCalendarResponse["invalidFiles"] = [];
    for (const f of files) {
      if (!f.parsed.ok) {
        invalidFiles.push({ agentId: f.agentId, name: f.name, error: f.parsed.error });
        continue;
      }
      if (!org.byId.has(f.agentId)) {
        invalidFiles.push({ agentId: f.agentId, name: f.name, error: "belongs to no employee" });
        continue;
      }
      const state = this.deps.cache.findCalendar(org.projectId, org.orgId, f.agentId, f.name);
      const def = f.parsed.value;
      const held = org.config.status === "paused" || paused.has(f.agentId);
      const next = calendarNextFireAt(def, state, nowMs);
      events.push({
        agentId: f.agentId,
        name: f.name,
        ...(def.title !== undefined ? { title: def.title } : {}),
        prompt: def.prompt,
        enabled: def.enabled,
        startAt: def.startAt,
        ...(def.period !== undefined ? { period: def.period } : {}),
        ...(def.endAt !== undefined ? { endAt: def.endAt } : {}),
        status: calendarStatus(def, state, nowMs),
        ...(state?.invalidReason ? { invalidReason: state.invalidReason } : {}),
        ...(next !== undefined ? { nextFireAt: next } : {}),
        ...(state?.lastFiredAt ? { lastFiredAt: state.lastFiredAt } : {}),
        ...(state?.lastOutcome ? { lastOutcome: state.lastOutcome } : {}),
        paused: held,
      });
    }
    return { events, invalidFiles };
  }

  async calendar(projectId: string, orgId: string): Promise<OrgCalendarResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    return this.calendarItems(org, spend);
  }

  async upsertCalendar(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    fields: Omit<OrgCalendarUpsertRequest, "agentId" | "name">,
    opts: { create: boolean },
  ): Promise<OrgCalendarWriteResponse> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      if (!org.byId.has(agentId))
        throw new HttpError(404, "employee_not_found", `${agentId} is not an employee.`);
      const existing = await this.deps.store.readCalendarEvent(org.dir, agentId, name);
      if (opts.create && existing !== null) {
        throw new HttpError(
          409,
          "calendar_event_exists",
          `Calendar event already exists: ${agentId}/${name}`,
        );
      }
      if (!opts.create && existing === null) {
        throw new HttpError(
          404,
          "calendar_event_not_found",
          `Calendar event does not exist: ${agentId}/${name}`,
        );
      }
      const raw = serializeCalendarEvent({
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        prompt: fields.prompt,
        enabled: fields.enabled,
        startAt: fields.startAt,
        ...(fields.period !== undefined ? { period: fields.period } : {}),
        ...(fields.endAt !== undefined ? { endAt: fields.endAt } : {}),
      });
      const parsed = parseCalendarEvent(name, raw);
      if (!parsed.ok) throw badRequest(`Invalid calendar event: ${parsed.error}`);
      await this.deps.store.writeCalendarEvent(org.dir, agentId, name, raw);
    });
    await this.scheduler.reconcile(projectId, orgId);
    const org = await this.requireOrg(projectId, orgId);
    const spend = await computeSpend(this.deps, org, (await listTickets(this.deps, org)).tickets);
    const list = await this.calendarItems(org, spend);
    const item = list.events.find((e) => e.agentId === agentId && e.name === name);
    if (!item)
      throw new HttpError(
        404,
        "calendar_event_not_found",
        `Calendar event does not exist: ${agentId}/${name}`,
      );
    // Advisory, computed over the whole calendar after the write: the rota is a property of
    // the organization, not of the one event, and the write is never refused for it.
    const warnings = rotaWarnings(list.events, item, this.now(), org.config.timezone);
    return { ...item, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  async deleteCalendar(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
  ): Promise<void> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      const removed = await this.deps.store.deleteCalendarEvent(org.dir, agentId, name);
      if (!removed)
        throw new HttpError(
          404,
          "calendar_event_not_found",
          `Calendar event does not exist: ${agentId}/${name}`,
        );
      this.deps.cache.deleteCalendar(projectId, orgId, agentId, name);
    });
  }

  // ---------------------------------------------------------------------------
  // Tickets
  // ---------------------------------------------------------------------------

  /** `known` is every ticket id in the same listing: a `Parent` naming none is flagged invalid. */
  private ticketItem(t: LoadedTicket, spend: OrgSpend, known: ReadonlySet<string>): OrgTicketItem {
    const d = t.doc;
    const running = d.sessions.some((s) => this.deps.runner.statusOf(s) !== "idle");
    return {
      ticketId: t.ticketId,
      title: d.title,
      status: d.status,
      initiator: d.initiator,
      ...(d.owner !== undefined ? { owner: d.owner } : {}),
      ...(d.parent !== undefined ? { parent: d.parent } : {}),
      notify: d.notify,
      priority: d.priority,
      ...(d.due !== undefined ? { due: d.due } : {}),
      ...(d.blocked !== undefined && d.blocked !== "" ? { blocked: d.blocked } : {}),
      ...(d.blockedBy !== undefined && d.blockedBy !== "" ? { blockedBy: d.blockedBy } : {}),
      sessions: d.sessions,
      running,
      cost: spend.ticket.get(t.ticketId) ?? 0,
      ...(d.parent !== undefined && !known.has(d.parent)
        ? { invalid: `Parent ${d.parent} does not exist` }
        : {}),
    };
  }

  private ticketItems(tickets: readonly LoadedTicket[], spend: OrgSpend): OrgTicketItem[] {
    const known = new Set(tickets.map((t) => t.ticketId));
    return tickets.map((t) => this.ticketItem(t, spend, known));
  }

  async tickets(projectId: string, orgId: string): Promise<OrgTicketsResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets, invalid } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    const columns = Object.fromEntries(
      ORG_TICKET_COLUMNS.map((c) => [c, [] as OrgTicketItem[]]),
    ) as Record<OrgTicketStatus, OrgTicketItem[]>;
    for (const item of this.ticketItems(tickets, spend)) columns[item.status].push(item);
    return { columns, invalidFiles: invalid };
  }

  private async ticketDetail(org: LoadedOrg, ticketId: string): Promise<OrgTicketDetail> {
    const { tickets } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    const t = tickets.find((x) => x.ticketId === ticketId);
    if (!t) throw ticketNotFound(ticketId);
    const item = this.ticketItem(t, spend, new Set(tickets.map((x) => x.ticketId)));
    const sessionItems: OrgTicketSessionItem[] = t.doc.sessions.map((sessionId) => {
      const row = this.deps.sessions.findById(sessionId);
      return {
        sessionId,
        agentId: row?.agentId ?? "",
        ...(row?.title ? { title: row.title } : {}),
        status: this.deps.runner.statusOf(sessionId),
        ...(row?.lastActiveAt ? { lastActiveAt: row.lastActiveAt } : {}),
      };
    });
    const file = await this.deps.store.findTicket(org.dir, ticketId);
    return {
      ...item,
      goal: t.doc.goal,
      acceptanceCriteria: t.doc.acceptanceCriteria,
      progress: t.doc.progress.map(
        (line) => parseProgressLine(line) ?? { time: "", by: "", text: line },
      ),
      result: t.doc.result,
      body: file?.raw ?? "",
      children: tickets.filter((x) => x.doc.parent === ticketId).map((x) => x.ticketId),
      rolledUpCost: spend.ticketRolledUp.get(ticketId) ?? 0,
      sessionItems,
    };
  }

  async ticket(projectId: string, orgId: string, ticketId: string): Promise<OrgTicketDetail> {
    const org = await this.requireOrg(projectId, orgId);
    return this.ticketDetail(org, ticketId);
  }

  private async requireTicket(org: LoadedOrg, ticketId: string): Promise<LoadedTicket> {
    if (!TICKET_ID_PATTERN.test(ticketId)) throw ticketNotFound(ticketId);
    const file = await this.deps.store.findTicket(org.dir, ticketId);
    if (file === null) throw ticketNotFound(ticketId);
    if (!file.parsed.ok)
      throw new HttpError(
        409,
        "ticket_invalid",
        `Ticket ${ticketId} needs repair: ${file.parsed.error}`,
      );
    return { ticketId, column: file.column, relPath: file.relPath, doc: file.parsed.value };
  }

  private requirePerson(raw: string, label: string): string {
    const p = parsePrincipal(raw);
    if (p === null || (p.kind !== "agent" && p.kind !== "user")) {
      throw badRequest(`${label} must be agent:<id> or user:<id>.`);
    }
    return raw.trim();
  }

  /**
   * `initiator`: who the ticket is filed as when it is not the caller. A bare Agent id or
   * `agent:<id>` has to be an employee and `user:<id>` a Project member — a ticket filed in
   * the name of somebody the organization does not have is a ticket nobody can be notified about.
   */
  private requireInitiator(org: LoadedOrg, raw: string): string {
    const value = raw.trim();
    const parsed = parsePrincipal(value);
    if (parsed === null && org.byId.has(value)) return agentPrincipal(value);
    if (parsed?.kind === "agent" && org.byId.has(parsed.id)) return agentPrincipal(parsed.id);
    if (parsed?.kind === "user" && this.projectUserIds(org).includes(parsed.id)) {
      return userPrincipal(parsed.id);
    }
    throw badRequest(
      `initiator must be an employee of ${org.orgId} (an Agent id or agent:<id>) or a member of this Project (user:<id>): ${raw}`,
    );
  }

  /**
   * The `Notify` list a ticket gets when the filer named none: an employee initiator is told
   * at its desk, so it defaults to itself; a person is not, because one @-mention per closed
   * ticket is a badge nobody asked for — a person who wants to be told lists itself.
   */
  private defaultNotify(initiator: string): string[] {
    return principalAgentId(initiator) !== null ? [initiator] : [];
  }

  /**
   * Books the calling session as a contributing session of the ticket. A write that claims
   * work — a progress line, an edit of the body, the move into `review` — from inside one of
   * this organization's sessions puts that session on the `Sessions` header, so its cost is
   * split onto the ticket: a desk that did the work at its own table is at least paid for out
   * of the ticket's budget. Management writes (accepting, closing, blocking, unblocking) book
   * nothing — a CEO's desk that accepts twenty tickets has not worked on twenty tickets.
   * Mutates `doc`; returns the session booked, or null when there was none to book.
   */
  private bookSession(
    org: LoadedOrg,
    actor: Actor,
    doc: TicketDoc,
  ): { sessionId: string; agentId: string } | null {
    const sessionId = actor.sessionId;
    if (sessionId === undefined) return null;
    const agentId = principalAgentId(this.actorPrincipal(org, actor));
    if (agentId === null || doc.sessions.includes(sessionId)) return null;
    doc.sessions = [...doc.sessions, sessionId];
    return { sessionId, agentId };
  }

  /** The cache twin of `bookSession`: the projection a write outside a reconcile would not refresh. */
  private cacheBookedSession(
    org: LoadedOrg,
    ticketId: string,
    booked: { sessionId: string; agentId: string } | null,
  ): void {
    if (booked === null) return;
    this.deps.cache.addTicketSession(
      org.projectId,
      org.orgId,
      ticketId,
      booked.sessionId,
      booked.agentId,
    );
  }

  async createTicket(
    projectId: string,
    orgId: string,
    req: OrgTicketCreateRequest,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    const ticketId = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const title = req.title.trim();
      if (title === "") throw badRequest("title must not be empty.");
      const initiator =
        req.initiator !== undefined && req.initiator.trim() !== ""
          ? this.requireInitiator(org, req.initiator)
          : this.actorPrincipal(org, actor);
      const date = zonedDate(org.config.timezone, this.now());
      const base = req.slug !== undefined ? slugify(req.slug) : slugify(title);
      const slug = base !== "" ? base : `t-${Math.random().toString(16).slice(2, 8)}`;
      let id = `${date}-${slug}`;
      for (let n = 2; (await this.deps.store.findTicket(org.dir, id)) !== null; n++)
        id = `${date}-${slug}-${n}`;
      if (!TICKET_ID_PATTERN.test(id))
        throw badRequest("The title yields no usable ticket id; pass a slug.");
      if (
        req.parent !== undefined &&
        (await this.deps.store.findTicket(org.dir, req.parent)) === null
      ) {
        throw badRequest(`Parent ticket does not exist: ${req.parent}`);
      }
      const owner =
        req.owner !== undefined && req.owner !== ""
          ? this.requirePerson(req.owner, "owner")
          : undefined;
      const notify = (req.notify ?? []).map((n) => this.requirePerson(n, "notify"));
      const doc: TicketDoc = {
        title,
        status: "proposed",
        initiator,
        ...(owner !== undefined ? { owner } : {}),
        ...(req.parent !== undefined ? { parent: req.parent } : {}),
        notify: notify.length > 0 ? notify : this.defaultNotify(initiator),
        priority: req.priority ?? "P2",
        ...(req.due !== undefined ? { due: req.due } : {}),
        sessions: [],
        goal: (req.body ?? req.goal ?? "").trim(),
        acceptanceCriteria: req.body !== undefined ? "" : (req.acceptanceCriteria ?? "").trim(),
        progress: [
          progressLine(new Date(this.now()).toISOString(), initiator, "created the ticket"),
        ],
        result: "",
        extraHeaders: [],
        extraSections: [],
      };
      // Baseline the notice state with no owner, so an owner set at creation is noticed as an assignment.
      this.deps.cache.upsertTicketState({
        projectId,
        orgId,
        ticketId: id,
        status: "proposed",
        owner: "",
        blocked: "",
        blockedBy: "",
      });
      await this.deps.store.writeTicket(org.dir, id, "proposed", doc);
      this.deps.notifyProject(projectId, {
        type: "org_ticket",
        projectId,
        orgId,
        ticketId: id,
        change: "created",
      });
      return id;
    });
    await this.scheduler.reconcile(projectId, orgId);
    return this.ticket(projectId, orgId, ticketId);
  }

  async updateTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    req: OrgTicketUpdateRequest,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      const d = t.doc;
      if (req.title !== undefined) {
        if (req.title.trim() === "") throw badRequest("title must not be empty.");
        d.title = req.title.trim();
      }
      if (req.owner === null) delete d.owner;
      else if (req.owner !== undefined) d.owner = this.requirePerson(req.owner, "owner");
      if (req.parent === null) delete d.parent;
      else if (req.parent !== undefined) {
        if (
          req.parent === ticketId ||
          (await this.deps.store.findTicket(org.dir, req.parent)) === null
        ) {
          throw badRequest(`Parent ticket does not exist: ${req.parent}`);
        }
        d.parent = req.parent;
      }
      if (req.notify !== undefined) {
        const notify = req.notify.map((n) => this.requirePerson(n, "notify"));
        d.notify = notify.length > 0 ? notify : this.defaultNotify(d.initiator);
      }
      if (req.priority !== undefined) d.priority = req.priority;
      if (req.due === null) delete d.due;
      else if (req.due !== undefined) d.due = req.due;
      if (req.goal !== undefined) d.goal = req.goal.trim();
      if (req.acceptanceCriteria !== undefined)
        d.acceptanceCriteria = req.acceptanceCriteria.trim();
      if (req.result !== undefined) d.result = req.result.trim();
      d.progress.push(
        progressLine(
          new Date(this.now()).toISOString(),
          this.actorPrincipal(org, actor),
          "updated the ticket",
          actor.sessionId,
        ),
      );
      const booked = this.bookSession(org, actor, d);
      await this.deps.store.writeTicket(org.dir, ticketId, t.column, d);
      this.cacheBookedSession(org, ticketId, booked);
      this.deps.notifyProject(projectId, {
        type: "org_ticket",
        projectId,
        orgId,
        ticketId,
        change: "updated",
      });
    });
    await this.scheduler.reconcile(projectId, orgId);
    return this.ticket(projectId, orgId, ticketId);
  }

  async moveTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    status: OrgTicketStatus,
    reason: string | undefined,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      if (!isTicketColumn(status)) throw badRequest("status must be a board column.");
      const t = await this.requireTicket(org, ticketId);
      if (status === "rejected" && (reason === undefined || reason.trim() === "")) {
        throw badRequest("Moving a ticket to rejected needs a reason.");
      }
      const by = this.actorPrincipal(org, actor);
      const d = t.doc;
      const from = t.column;
      d.status = status;
      if (reason !== undefined && reason.trim() !== "") {
        d.result =
          d.result.trim() === "" ? reason.trim() : `${d.result.trim()}\n\n${reason.trim()}`;
      }
      d.progress.push(
        progressLine(
          new Date(this.now()).toISOString(),
          by,
          `moved ${from} → ${status}${reason ? `: ${reason.trim()}` : ""}`,
          actor.sessionId,
        ),
      );
      // Handing work in is a claim of work; accepting, closing and rejecting are decisions.
      const booked = status === "review" ? this.bookSession(org, actor, d) : null;
      await this.deps.store.moveTicket(org.dir, ticketId, from, status, d);
      this.cacheBookedSession(org, ticketId, booked);
    });
    await this.scheduler.reconcile(projectId, orgId);
    return this.ticket(projectId, orgId, ticketId);
  }

  async blockTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    reason: string,
    by: string | undefined,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      if (reason.trim() === "") throw badRequest("reason must not be empty.");
      if (by !== undefined && by !== "") {
        const p = parsePrincipal(by);
        const isTicket = TICKET_ID_PATTERN.test(by);
        if (!isTicket && (p === null || (p.kind !== "agent" && p.kind !== "user"))) {
          throw badRequest("by must be a ticket id or agent:<id> / user:<id>.");
        }
        if (isTicket && (await this.deps.store.findTicket(org.dir, by)) === null) {
          throw badRequest(`Blocking ticket does not exist: ${by}`);
        }
      }
      const d = t.doc;
      d.blocked = reason.trim();
      if (by !== undefined && by !== "") d.blockedBy = by.trim();
      else delete d.blockedBy;
      d.progress.push(
        progressLine(
          new Date(this.now()).toISOString(),
          this.actorPrincipal(org, actor),
          `blocked: ${reason.trim()}${by ? ` (waiting on ${by})` : ""}`,
          actor.sessionId,
        ),
      );
      await this.deps.store.writeTicket(org.dir, ticketId, t.column, d);
    });
    await this.scheduler.reconcile(projectId, orgId);
    return this.ticket(projectId, orgId, ticketId);
  }

  async unblockTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      const d = t.doc;
      delete d.blocked;
      delete d.blockedBy;
      d.progress.push(
        progressLine(
          new Date(this.now()).toISOString(),
          this.actorPrincipal(org, actor),
          "unblocked",
          actor.sessionId,
        ),
      );
      await this.deps.store.writeTicket(org.dir, ticketId, t.column, d);
    });
    await this.scheduler.reconcile(projectId, orgId);
    return this.ticket(projectId, orgId, ticketId);
  }

  async progressTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    text: string,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      if (text.trim() === "") throw badRequest("text must not be empty.");
      t.doc.progress.push(
        progressLine(
          new Date(this.now()).toISOString(),
          this.actorPrincipal(org, actor),
          text,
          actor.sessionId,
        ),
      );
      const booked = this.bookSession(org, actor, t.doc);
      await this.deps.store.writeTicket(org.dir, ticketId, t.column, t.doc);
      this.cacheBookedSession(org, ticketId, booked);
      this.deps.notifyProject(projectId, {
        type: "org_ticket",
        projectId,
        orgId,
        ticketId,
        change: "progress",
      });
    });
    return this.ticket(projectId, orgId, ticketId);
  }

  /**
   * Opens a ticket session. Who may open one is the ticket's own rule: a person may open a
   * session for any ticket, naming the employee with `agentId`; an employee may open one
   * only for a ticket it owns. A desk that wants a colleague's ticket worked assigns it and
   * lets that desk pick it up in its next sweep — an assignment is how work moves between
   * employees, and a session opened around it leaves the owner with work it never saw. The
   * owner may still pass `agentId` to enlist a colleague on its OWN ticket, which is how a
   * request for help in a channel is answered.
   */
  async startTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    req: { agentId?: string; message?: string; workspace?: string },
    actor: Actor,
  ): Promise<{ sessionId: string }> {
    const sessionId = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      const owner = t.doc.owner !== undefined ? principalAgentId(t.doc.owner) : null;
      const caller = this.actorEmployee(org, actor);
      if (caller !== null && caller !== owner) {
        throw new HttpError(
          403,
          "not_ticket_owner",
          owner === null
            ? `Only the ticket's owner starts its sessions; ${ticketId} has no employee owner — assign an owner first (\`penguin org ticket assign ${ticketId} --owner agent:<employee>\`) and its desk picks it up in its next sweep.`
            : `Only the ticket's owner starts its sessions; assign the ticket (\`penguin org ticket assign ${ticketId} --owner agent:<employee>\`) and its desk picks it up in its next sweep.`,
        );
      }
      const agentId = req.agentId ?? owner;
      if (agentId === null) {
        throw badRequest("The ticket has no employee owner; pass agentId.");
      }
      if (!org.byId.has(agentId))
        throw new HttpError(404, "employee_not_found", `${agentId} is not an employee.`);
      const spend = await computeSpend(this.deps, org, (await listTickets(this.deps, org)).tickets);
      const r = await openTicketSession(this.deps, org, t, agentId, {
        ...(req.message !== undefined ? { message: req.message } : {}),
        ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
        budget: budgetLine(org, spend, agentId),
      });
      if (!r.ok) throw new HttpError(409, "ticket_session_failed", r.error);
      return r.sessionId;
    });
    await this.scheduler.reconcile(projectId, orgId, { triggers: false });
    return { sessionId };
  }

  async attachTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    sessionId: string,
    actor: Actor,
  ): Promise<OrgTicketDetail> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      const row = this.deps.sessions.findById(sessionId);
      if (!row || row.projectId !== projectId)
        throw new HttpError(404, "session_not_found", `Session does not exist: ${sessionId}`);
      if (!t.doc.sessions.includes(sessionId)) {
        t.doc.sessions = [...t.doc.sessions, sessionId];
        t.doc.progress.push(
          progressLine(
            new Date(this.now()).toISOString(),
            this.actorPrincipal(org, actor),
            "attached a session",
            sessionId,
          ),
        );
        await this.deps.store.writeTicket(org.dir, ticketId, t.column, t.doc);
        this.deps.cache.addTicketSession(projectId, orgId, ticketId, sessionId, row.agentId);
        this.deps.notifyProject(projectId, {
          type: "org_ticket",
          projectId,
          orgId,
          ticketId,
          change: "attached",
        });
      }
    });
    return this.ticket(projectId, orgId, ticketId);
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  /** Who is asking: an employee when the call came from one of its sessions, else the signed-in person. */
  private caller(
    org: LoadedOrg,
    actor: Actor,
  ): { principal: string; agentId: string | null; userId: string | null } {
    const principal = this.actorPrincipal(org, actor);
    const agentId = principalAgentId(principal);
    return { principal, agentId, userId: agentId === null ? actor.userId : null };
  }

  /** The Project's people: its owner and its members, the `user:` half of the all-hands channel. */
  private projectUserIds(org: LoadedOrg): string[] {
    const project = this.deps.projects.findById(org.projectId);
    const out: string[] = [];
    for (const id of [
      ...(project ? [project.ownerUserId] : []),
      ...this.deps.members.list(org.projectId).map((m) => m.userId),
    ]) {
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  /** A channel's membership as principals: the all-hands channel resolves to everyone, the rest to their list. */
  private channelMemberPrincipals(org: LoadedOrg, cfg: ChannelConfig): string[] {
    if (cfg.everyone !== true) return cfg.members ?? [];
    return [
      ...org.chart.employees.map((e) => agentPrincipal(e.agentId)),
      ...this.projectUserIds(org).map(userPrincipal),
    ];
  }

  /**
   * The channel's config, or 404. An unparsable `channel.toml` is skipped everywhere else,
   * so it is not there to be read or written either; the reason travels in the message
   * rather than in a second error code.
   */
  private async requireChannel(org: LoadedOrg, channelId: string): Promise<ChannelConfig> {
    if (!isChannelId(channelId)) throw channelNotFound(channelId);
    const file = await this.deps.store.readChannel(org.dir, channelId);
    if (file === null) throw channelNotFound(channelId);
    if (!file.parsed.ok) {
      throw new HttpError(
        404,
        "channel_not_found",
        `Channel ${channelId} has an invalid channel.toml: ${file.parsed.error}`,
      );
    }
    return file.parsed.value;
  }

  /** The last message's time, plus the caller's unread counts when the caller is a person. */
  private async channelActivity(
    org: LoadedOrg,
    channelId: string,
    userId: string | null,
  ): Promise<{ unread: number; mentionsMe: number; lastMessageAt: string | null }> {
    const days = await this.deps.store.listMessageDays(org.dir, channelId);
    let lastMessageAt: string | null = null;
    for (const d of days) {
      const list = (await this.deps.store.readMessageDay(org.dir, channelId, d)).messages;
      if (list.length > 0) {
        lastMessageAt = list.at(-1)!.time;
        break;
      }
    }
    // Read cursors belong to people; an employee reads its channel through its trigger.
    if (userId === null) return { unread: 0, mentionsMe: 0, lastMessageAt };
    const lastReadId = this.deps.cache.readCursor(org.projectId, org.orgId, channelId, userId);
    const me = userPrincipal(userId);
    let unread = 0;
    let mentionsMe = 0;
    for (const d of days.slice(0, 7)) {
      for (const m of (await this.deps.store.readMessageDay(org.dir, channelId, d)).messages) {
        if (lastReadId !== null && m.id <= lastReadId) continue;
        unread++;
        if (m.mentions.includes(me)) mentionsMe++;
      }
    }
    return { unread, mentionsMe, lastMessageAt };
  }

  private async channelItem(
    org: LoadedOrg,
    channelId: string,
    cfg: ChannelConfig,
    caller: { principal: string; userId: string | null },
  ): Promise<OrgChannelItem> {
    const members = this.channelMemberPrincipals(org, cfg);
    return {
      channelId,
      name: cfg.name,
      purpose: cfg.purpose,
      everyone: cfg.everyone === true,
      archived: cfg.archived,
      createdBy: cfg.createdBy,
      createdAt: cfg.createdAt,
      memberCount: members.length,
      isMember: members.includes(caller.principal),
      ...(await this.channelActivity(org, channelId, caller.userId)),
    };
  }

  private async channelMembers(org: LoadedOrg, cfg: ChannelConfig): Promise<OrgChannelMember[]> {
    const out: OrgChannelMember[] = [];
    for (const principal of this.channelMemberPrincipals(org, cfg)) {
      const parsed = parsePrincipal(principal);
      if (parsed?.kind === "agent") {
        const name = (await this.deps.agents.exists(org.projectId, parsed.id))
          ? await this.deps.agents.displayName(org.projectId, parsed.id)
          : parsed.id;
        out.push({ principal, name, kind: "agent" });
      } else if (parsed?.kind === "user") {
        out.push({ principal, name: parsed.id, kind: "user" });
      }
    }
    return out;
  }

  private async channelDetail(
    org: LoadedOrg,
    channelId: string,
    cfg: ChannelConfig,
    caller: { principal: string; userId: string | null },
  ): Promise<OrgChannelDetail> {
    return {
      ...(await this.channelItem(org, channelId, cfg, caller)),
      members: await this.channelMembers(org, cfg),
    };
  }

  /** People are the board and see every channel; an employee sees the channels it belongs to. */
  async channels(projectId: string, orgId: string, actor: Actor): Promise<OrgChannelsResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const caller = this.caller(org, actor);
    const channels: OrgChannelItem[] = [];
    for (const file of await this.deps.store.listChannels(org.dir)) {
      if (!file.parsed.ok) continue;
      const item = await this.channelItem(org, file.channelId, file.parsed.value, caller);
      if (caller.agentId !== null && !item.isMember) continue;
      channels.push(item);
    }
    channels.sort((a, b) =>
      a.channelId === DEFAULT_CHANNEL_ID
        ? -1
        : b.channelId === DEFAULT_CHANNEL_ID
          ? 1
          : a.name.localeCompare(b.name) || a.channelId.localeCompare(b.channelId),
    );
    return { channels };
  }

  /** A new channel holds exactly its creator; everyone else arrives by invitation (people may also join). */
  async createChannel(
    projectId: string,
    orgId: string,
    req: OrgChannelCreateRequest,
    actor: Actor,
  ): Promise<OrgChannelItem> {
    const channelId = req.channelId;
    const item = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      if (!isChannelId(channelId)) {
        throw badRequest(
          "Channel id must be 2–64 characters: a lowercase letter, then lowercase letters, digits or underscores.",
        );
      }
      if ((await this.deps.store.readChannel(org.dir, channelId)) !== null) {
        throw new HttpError(409, "channel_exists", `Channel id is already taken: ${channelId}`);
      }
      const caller = this.caller(org, actor);
      const cfg: ChannelConfig = {
        name: req.name?.trim() || channelId,
        purpose: req.purpose?.trim() ?? "",
        createdBy: caller.principal,
        createdAt: new Date(this.now()).toISOString(),
        archived: false,
        members: [caller.principal],
      };
      await this.deps.store.writeChannel(org.dir, channelId, cfg);
      await appendChannelMessage(
        this.deps,
        org,
        channelId,
        systemMessage(channelCreated(caller.principal)),
      );
      return this.channelItem(org, channelId, cfg, caller);
    });
    await this.scheduler.reconcile(projectId, orgId);
    return item;
  }

  async channel(
    projectId: string,
    orgId: string,
    channelId: string,
    actor: Actor,
  ): Promise<OrgChannelDetail> {
    const org = await this.requireOrg(projectId, orgId);
    const cfg = await this.requireChannel(org, channelId);
    const caller = this.caller(org, actor);
    this.requireReadAccess(org, channelId, cfg, caller);
    return this.channelDetail(org, channelId, cfg, caller);
  }

  /** People read every channel; an employee only the ones it belongs to. */
  private requireReadAccess(
    org: LoadedOrg,
    channelId: string,
    cfg: ChannelConfig,
    caller: { principal: string; agentId: string | null },
  ): void {
    if (caller.agentId === null) return;
    if (this.channelMemberPrincipals(org, cfg).includes(caller.principal)) return;
    throw notAMember(channelId, caller.principal);
  }

  async patchChannel(
    projectId: string,
    orgId: string,
    channelId: string,
    req: OrgChannelPatchRequest,
    actor: Actor,
  ): Promise<OrgChannelItem> {
    const item = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      const cfg = await this.requireChannel(org, channelId);
      const caller = this.caller(org, actor);
      const members = this.channelMemberPrincipals(org, cfg);
      if (req.archived !== undefined) {
        if (channelId === DEFAULT_CHANNEL_ID) {
          throw allHandsImmutable("The all-hands channel cannot be archived.");
        }
        if (caller.agentId !== null) {
          throw notAMember(channelId, caller.principal, "Only people archive a channel.");
        }
      }
      // Everything but lifting the archive itself is refused while the channel is archived.
      if (cfg.archived && req.archived !== false) throw channelArchived(channelId);
      const renaming = req.name !== undefined || req.purpose !== undefined;
      if (renaming && !members.includes(caller.principal)) {
        throw notAMember(channelId, caller.principal);
      }
      const next: ChannelConfig = { ...cfg };
      if (req.name !== undefined) {
        if (req.name.trim() === "") throw badRequest("name must not be empty.");
        next.name = req.name.trim();
      }
      if (req.purpose !== undefined) next.purpose = req.purpose.trim();
      const archiveChanged = req.archived !== undefined && req.archived !== cfg.archived;
      // The notice is written before the flag: an archived channel is skipped by the scan,
      // so a line written after it would wait for the unarchive to reach the event stream.
      if (archiveChanged) {
        await appendChannelMessage(
          this.deps,
          org,
          channelId,
          systemMessage(channelArchiveChanged(caller.principal, req.archived === true)),
        );
        next.archived = req.archived === true;
      }
      await this.deps.store.writeChannel(org.dir, channelId, next);
      return this.channelItem(org, channelId, next, caller);
    });
    await this.scheduler.reconcile(projectId, orgId);
    return item;
  }

  /** `agent:<id>` must be an employee and `user:<id>` a Project member — nobody else can be in a channel. */
  private requireChannelPrincipal(org: LoadedOrg, raw: string): string {
    const parsed = parsePrincipal(raw);
    if (parsed?.kind === "agent" && org.byId.has(parsed.id)) return agentPrincipal(parsed.id);
    if (parsed?.kind === "user" && this.projectUserIds(org).includes(parsed.id)) {
      return userPrincipal(parsed.id);
    }
    throw new HttpError(
      400,
      "invalid_principal",
      `Not an employee of ${org.orgId} or a member of this Project: ${raw}`,
    );
  }

  /** Any member invites; a person may also join by itself, an employee may not. */
  async addChannelMember(
    projectId: string,
    orgId: string,
    channelId: string,
    rawPrincipal: string,
    actor: Actor,
  ): Promise<OrgChannelDetail> {
    const detail = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      const cfg = await this.requireChannel(org, channelId);
      if (channelId === DEFAULT_CHANNEL_ID) {
        throw allHandsImmutable("Everyone is in the all-hands channel already.");
      }
      if (cfg.archived) throw channelArchived(channelId);
      const principal = this.requireChannelPrincipal(org, rawPrincipal);
      const caller = this.caller(org, actor);
      const members = cfg.members ?? [];
      if (principal === caller.principal) {
        if (caller.agentId !== null) {
          throw notAMember(
            channelId,
            caller.principal,
            "An employee joins a channel only when a member invites it.",
          );
        }
      } else if (!members.includes(caller.principal)) {
        throw notAMember(channelId, caller.principal);
      }
      if (members.includes(principal)) return this.channelDetail(org, channelId, cfg, caller);
      const next: ChannelConfig = { ...cfg, members: [...members, principal] };
      await this.deps.store.writeChannel(org.dir, channelId, next);
      await appendChannelMessage(
        this.deps,
        org,
        channelId,
        systemMessage(channelMemberAdded(caller.principal, principal)),
      );
      return this.channelDetail(org, channelId, next, caller);
    });
    await this.scheduler.reconcile(projectId, orgId);
    return detail;
  }

  /** A member removes itself; a person may remove anyone. Removing a non-member changes nothing. */
  async removeChannelMember(
    projectId: string,
    orgId: string,
    channelId: string,
    rawPrincipal: string,
    actor: Actor,
  ): Promise<void> {
    await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      const cfg = await this.requireChannel(org, channelId);
      if (channelId === DEFAULT_CHANNEL_ID) {
        throw allHandsImmutable("Nobody leaves the all-hands channel.");
      }
      if (cfg.archived) throw channelArchived(channelId);
      const parsed = parsePrincipal(rawPrincipal);
      if (parsed?.kind !== "agent" && parsed?.kind !== "user") {
        throw new HttpError(400, "invalid_principal", `Not a principal: ${rawPrincipal}`);
      }
      const principal =
        parsed.kind === "agent" ? agentPrincipal(parsed.id) : userPrincipal(parsed.id);
      const caller = this.caller(org, actor);
      if (caller.agentId !== null && principal !== caller.principal) {
        throw notAMember(
          channelId,
          caller.principal,
          "An employee removes only itself from a channel.",
        );
      }
      const members = cfg.members ?? [];
      if (!members.includes(principal)) return;
      await this.deps.store.writeChannel(org.dir, channelId, {
        ...cfg,
        members: members.filter((m) => m !== principal),
      });
      await appendChannelMessage(
        this.deps,
        org,
        channelId,
        systemMessage(channelMemberRemoved(caller.principal, principal)),
      );
    });
    await this.scheduler.reconcile(projectId, orgId);
  }

  // ---------------------------------------------------------------------------
  // Channel messages
  // ---------------------------------------------------------------------------

  async channelMessages(
    projectId: string,
    orgId: string,
    actor: Actor,
    channelId: string,
    opts: { date?: string },
  ): Promise<OrgChannelMessagesResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const cfg = await this.requireChannel(org, channelId);
    const caller = this.caller(org, actor);
    this.requireReadAccess(org, channelId, cfg, caller);
    const days = await this.deps.store.listMessageDays(org.dir, channelId);
    const today = zonedDate(org.config.timezone, this.now());
    const date = opts.date ?? today;
    const messages = (await this.deps.store.readMessageDay(org.dir, channelId, date)).messages;
    const lastReadId =
      caller.userId === null
        ? null
        : this.deps.cache.readCursor(projectId, orgId, channelId, caller.userId);
    const me = caller.userId === null ? null : userPrincipal(caller.userId);
    let unread = 0;
    let mentionsMe = 0;
    if (me !== null) {
      for (const d of days.slice(0, 7)) {
        const list =
          d === date
            ? messages
            : (await this.deps.store.readMessageDay(org.dir, channelId, d)).messages;
        for (const m of list) {
          if (lastReadId !== null && m.id <= lastReadId) continue;
          unread++;
          if (m.mentions.includes(me)) mentionsMe++;
        }
      }
    }
    return {
      channelId,
      date,
      days,
      messages,
      unread,
      mentionsMe,
      ...(lastReadId !== null ? { lastReadId } : {}),
    };
  }

  /** Resolves `@` tokens: employees first, then Project members; the writer disambiguates with a prefix. */
  private resolveMentions(org: LoadedOrg, text: string): string[] {
    const users = new Set(this.projectUserIds(org));
    const out: string[] = [];
    const add = (p: string): void => {
      if (!out.includes(p)) out.push(p);
    };
    for (const token of extractMentionTokens(text)) {
      if (token.id === "all" && token.prefix === undefined) {
        add("all");
        continue;
      }
      if (token.prefix === "agent") {
        if (org.byId.has(token.id)) add(agentPrincipal(token.id));
      } else if (token.prefix === "user") {
        if (users.has(token.id)) add(userPrincipal(token.id));
      } else if (org.byId.has(token.id)) {
        add(agentPrincipal(token.id));
      } else if (users.has(token.id)) {
        add(userPrincipal(token.id));
      }
    }
    return out;
  }

  async sendChannelMessage(
    projectId: string,
    orgId: string,
    userId: string,
    channelId: string,
    req: OrgChannelMessageSendRequest,
  ): Promise<OrgChannelMessage> {
    const msg = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      const text = req.text.trim();
      if (text === "") throw badRequest("text must not be empty.");
      const cfg = await this.requireChannel(org, channelId);
      if (cfg.archived) throw channelArchived(channelId);
      let sender = userPrincipal(userId);
      let hop = 0;
      if (req.sessionId !== undefined) {
        const owner = this.deps.cache.ownerOfSession(req.sessionId);
        if (owner && owner.projectId === projectId && owner.orgId === orgId) {
          sender = agentPrincipal(owner.agentId);
          hop = owner.triggerHop + 1;
        } else {
          const row = this.deps.sessions.findById(req.sessionId);
          if (row && row.projectId === projectId && org.byId.has(row.agentId)) {
            sender = agentPrincipal(row.agentId);
            hop = 1;
          }
        }
      }
      const members = this.channelMemberPrincipals(org, cfg);
      if (!members.includes(sender)) throw notAMember(channelId, sender);
      const mentions = this.resolveMentions(org, text);
      // `@all` is the channel's own membership, so only named principals can be outsiders.
      const outsiders = mentions.filter((m) => m !== "all" && !members.includes(m));
      if (outsiders.length > 0) {
        throw new HttpError(
          400,
          "mention_not_member",
          `Not a member of ${channelId}: ${outsiders.join(", ")}. Invite them first, or write in a channel they are in.`,
        );
      }
      const refs = req.refs;
      return appendChannelMessage(this.deps, org, channelId, {
        sender,
        hop,
        text,
        mentions,
        ...(refs !== undefined && Object.keys(refs).length > 0 ? { refs } : {}),
      });
    });
    await this.scheduler.reconcile(projectId, orgId);
    return msg;
  }

  async markRead(
    projectId: string,
    orgId: string,
    userId: string,
    channelId: string,
    upTo: string,
  ): Promise<void> {
    const org = await this.requireOrg(projectId, orgId);
    await this.requireChannel(org, channelId);
    const current = this.deps.cache.readCursor(projectId, orgId, channelId, userId);
    if (current === null || upTo > current)
      this.deps.cache.setReadCursor(projectId, orgId, channelId, userId, upTo);
  }

  // ---------------------------------------------------------------------------
  // Finance and sessions
  // ---------------------------------------------------------------------------

  async finance(projectId: string, orgId: string, period?: string): Promise<OrgFinanceResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets, period);
    const marks = new Map(
      this.deps.cache.listBudgetStates(projectId, orgId, spend.period).map((s) => [s.agentId, s]),
    );
    const employees: OrgFinanceResponse["employees"] = [];
    for (const e of org.chart.employees) {
      const cumulative = spend.cumulative.get(e.agentId) ?? 0;
      const mark = marks.get(e.agentId);
      employees.push({
        agentId: e.agentId,
        name: (await this.deps.agents.exists(projectId, e.agentId))
          ? await this.deps.agents.displayName(projectId, e.agentId)
          : e.agentId,
        title: e.title,
        reportsTo: e.reportsTo,
        own: spend.own.get(e.agentId) ?? 0,
        cumulative,
        ...(e.budget !== undefined ? { budget: e.budget } : {}),
        ...(e.budget !== undefined && e.budget > 0 ? { ratio: cumulative / e.budget } : {}),
        warned: mark?.warnedAt !== undefined && mark.warnedAt !== null,
        paused: mark?.pausedAt !== undefined && mark.pausedAt !== null,
      });
    }
    const daily = await this.deps.usage.dailyCostForSessions(
      projectId,
      spend.sessionIds,
      new Date(spend.range.fromMs).toISOString(),
      new Date(spend.range.toMs - 1).toISOString(),
    );
    return {
      period: spend.period,
      currency: "USD",
      employees,
      tickets: tickets.map((t) => ({
        ticketId: t.ticketId,
        title: t.doc.title,
        status: t.doc.status,
        ...(t.doc.parent !== undefined ? { parent: t.doc.parent } : {}),
        cost: spend.ticket.get(t.ticketId) ?? 0,
        rolledUp: spend.ticketRolledUp.get(t.ticketId) ?? 0,
      })),
      daily,
      alerts: this.alerts(org, spend.period),
      total: spend.cumulative.get(ceoAgentId(orgId)) ?? 0,
      unpriced: spend.unpriced,
    };
  }

  async sessions(projectId: string, orgId: string): Promise<OrgSessionsResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets } = await listTickets(this.deps, org);
    syncCaches(this.deps, org, tickets);
    const desks: OrgSessionsResponse["desks"] = [];
    for (const e of org.chart.employees) {
      const desk = org.desks[e.agentId];
      if (!desk) continue;
      const row = this.deps.sessions.findById(desk.sessionId);
      desks.push({
        agentId: e.agentId,
        name: (await this.deps.agents.exists(projectId, e.agentId))
          ? await this.deps.agents.displayName(projectId, e.agentId)
          : e.agentId,
        sessionId: desk.sessionId,
        ...(row?.title ? { title: row.title } : {}),
        status: this.deps.runner.statusOf(desk.sessionId),
        workspace: desk.workspace,
        ...(row?.lastActiveAt ? { lastActiveAt: row.lastActiveAt } : {}),
      });
    }
    const ticketGroups: OrgSessionsResponse["tickets"] = [];
    for (const t of tickets) {
      if (t.doc.sessions.length === 0) continue;
      ticketGroups.push({
        ticketId: t.ticketId,
        title: t.doc.title,
        status: t.doc.status,
        sessions: t.doc.sessions.map((sessionId) => {
          const row = this.deps.sessions.findById(sessionId);
          return {
            sessionId,
            agentId: row?.agentId ?? "",
            ...(row?.title ? { title: row.title } : {}),
            status: this.deps.runner.statusOf(sessionId),
            ...(row?.lastActiveAt ? { lastActiveAt: row.lastActiveAt } : {}),
          };
        }),
      });
    }
    return { desks, tickets: ticketGroups };
  }
}

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

function requireHandbookPath(rel: string): void {
  if (!isHandbookFilePath(rel))
    throw new HttpError(
      400,
      "invalid_path",
      `${rel} is not a handbook path: plain segments, no hidden files, no traversal.`,
    );
}

/** How many rows one inbox list carries: a page, the same cap the overview renders. */
const INBOX_PAGE = 20;

/** A progress line `moveTicket` writes when a ticket lands in `done`, reason or not. */
const MOVED_TO_DONE = /^moved \S+ → done(?::|$)/;

/**
 * The time a ticket last moved into `done`, from its progress log. Null when the log has no
 * such line, which is what a ticket moved by editing its file looks like.
 */
function lastClosedAt(doc: TicketDoc): string | null {
  for (let i = doc.progress.length - 1; i >= 0; i -= 1) {
    const entry = parseProgressLine(doc.progress[i]!);
    if (entry !== null && MOVED_TO_DONE.test(entry.text)) return entry.time;
  }
  return null;
}

/**
 * The prompt behind a model-backed semantic id: the model translates a display name into
 * one snake_case English identifier — the semantic core only, since `sanitizeSuggestedId`
 * puts the kind's prefix (`co_` / `ch_`) in front of whatever comes back. Examples in both
 * scripts, the taken ids named so the answer does not collide, and no room for prose;
 * anything that does not survive the sanitizer falls back to the ASCII slug.
 */
function semanticIdPrompt(req: SemanticIdSuggestRequest): string {
  const taken = (req.taken ?? []).join(", ");
  return [
    "You produce identifiers. Given a display name, answer with ONE snake_case ASCII identifier:",
    "lowercase letters, digits and underscores, starting with a letter, 2–40 characters, made of",
    "English words that carry the name's meaning (translate a non-English name), no explanation,",
    "nothing else. Examples: Plugin Marketplace → plugin_marketplace; 科研论文公司 →",
    "research_paper_lab; 市场推广 → marketing; Site → site.",
    "Do not add any prefix of your own; one is added to your answer.",
    ...(taken !== "" ? [`Those answers are taken, prefix included: ${taken}.`] : []),
    `Name: ${req.name}`,
  ].join(" ");
}

/** The AGENTS.md written for an Agent created as an employee: who it is in this organization and where the handbook is. */
export function employeeBrief(input: {
  orgId: string;
  name: string;
  mission: string;
  agentId: string;
  title: string;
  reportsTo: string | null;
  language: OrgLanguage;
  duties?: string;
}): string {
  if (input.language === "zh") {
    return `# 员工简介

你是 \`${input.agentId}\`，组织 **${input.name}**（\`${input.orgId}\`）的${input.title}，向${input.reportsTo === null ? "董事会" : `\`${input.reportsTo}\``}汇报。

使命：${input.mission}
${input.duties !== undefined ? `\n职责：${input.duties}\n` : ""}
本组织的工作语言是中文：频道消息、工单、手册文档与汇报都用中文书写，命令、文件名、id 与字段名保持 ASCII。

你的组织目录是 \`<app_data_dir>/organizations/${input.orgId}/\`。每轮工作开始时先读 \`handbook/README.md\`（组织手册的索引；这个目录是公司的知识库），然后按 \`company-employee\` Skill 行事；头衔属于哪个角色，就再用 \`company-ceo\`、\`company-hr\` 或 \`company-finance\`。在你的会话里，\`penguin org\` 命令已经从环境中知道你的组织、Project、Agent 与当前会话。
`;
  }
  return `# Employee brief

You are \`${input.agentId}\`, ${input.title} of the organization **${input.name}** (\`${input.orgId}\`), reporting to ${input.reportsTo === null ? "the board" : `\`${input.reportsTo}\``}.

Mission: ${input.mission}
${input.duties !== undefined ? `\nDuties: ${input.duties}\n` : ""}
This organization works in English: channel messages, tickets, handbook documents and reports are written in it; commands, file names, ids and field names stay ASCII.

Your organization directory is \`<app_data_dir>/organizations/${input.orgId}/\`. At the start of every work run read \`handbook/README.md\` (the handbook index; the directory is the company's knowledge base), then follow the \`company-employee\` skill; use \`company-ceo\`, \`company-hr\` or \`company-finance\` when your title is that role. Inside your sessions the \`penguin org\` commands already know your organization, Project, Agent and session from the environment.
`;
}

/** The body of the CEO's initialization work run, in the organization's working language. */
function initBody(org: LoadedOrg): string {
  const board = userPrincipal(org.config.createdBy);
  const ceo = ceoAgentId(org.orgId);
  if (orgLanguage(org.config) === "zh") {
    return [
      `使命：${org.config.mission}`,
      "",
      "你是一家全新组织的 CEO，这是它的初始化运行。重要的事由董事会拍板，你负责提案。按顺序完成下面几件事：",
      `1. 读手册。然后在全员频道里给董事会（${board}）写一份提案——\`penguin org channel send -m "@${board} …"\`——写清你对使命的理解、打算开的工作线与首批工单、打算招募的角色（先人事与财务）及其预算与 Model，以及公共工作区怎么划分。以明确的问题结尾，然后结束本轮：董事会答复之前不招人、不排日程、不开工单。`,
      `2. 答复会以提及或本会话消息的形式到来。董事会确认后，先招人事与财务——\`penguin org hire --new-agent ${org.orgId}_hr --title HR --reports-to ${ceo} --duties "…"\`，\`${org.orgId}_finance\` 同理——再招确认过的其他角色。`,
      "3. 按确认的方案划分公共工作区：把子目录分配下去（`penguin org employee set <agent_id> --workspace <子目录>`）；相对子目录会在分配时自动建好。",
      "4. 把你自己、人事与财务排进日历（`penguin org calendar add …`），做成轮值表而不是广播：你每天 09:00，人事每三天 10:00，财务每周 16:00（组织时区，写成带偏移量的 ISO 时刻，绝不用 `--start-at now`），此后每招一人就给它一个各自不同的时点。",
      "5. 把确认过的工单开进 `proposed`（`penguin org ticket create …`）：一个项目级目标一张父工单，每条工作线一张子工单。接受一张工单进入 `in_progress` 时就指派负责人（`penguin org ticket assign <id> --owner agent:<员工>`）：那名员工的工位会在下一次巡检时接手并发起工单会话。只有工单的负责人可以为它发起会话，所以你只为自己名下的工单执行 `penguin org ticket start <id>`；工位只负责调度与跟踪，绝不在工位上做工单本身的活。",
      "6. 每条工作线开一个频道（`penguin org channel create ch_<工作线> --name …`）并邀请它的负责人（`penguin org channel invite ch_<工作线> agent:<agent_id>`），免得一条线索淹没全员频道。",
      `7. 在全员频道里向董事会汇报并 @${board}，如果还需要拍板，就点明下一个决定。`,
    ].join("\n");
  }
  return [
    `Mission: ${org.config.mission}`,
    "",
    "You are the CEO of a brand-new organization and this is its initialization run. The board decides the important things; you propose. Work through the following, in order:",
    `1. Read the handbook. Then write ONE proposal to the board (${board}) in the all-hands channel — \`penguin org channel send -m "@${board} …"\` — with your reading of the mission, the streams and first tickets you intend to file, the roles you intend to hire (HR and finance first) with budgets and model, and how you will split the shared workspace. End with the explicit question and END THIS RUN: hire nothing, schedule nothing and file nothing before the board answers.`,
    `2. The answer arrives as a mention or in this conversation. Once the board confirms, hire HR and finance first — \`penguin org hire --new-agent ${org.orgId}_hr --title HR --reports-to ${ceo} --duties "…"\` and the same for \`${org.orgId}_finance\` — then the confirmed roles.`,
    "3. Partition the shared workspace as confirmed: assign the sub-directories (`penguin org employee set <agent_id> --workspace <sub-directory>`); a relative sub-directory is created when you assign it.",
    "4. Put yourself, HR and finance on the calendar (`penguin org calendar add …`) as a rota, not a broadcast: you daily at 09:00, HR every three days at 10:00, finance weekly at 16:00 (organization timezone, ISO instants with the offset — never `--start-at now`), and give every later hire its own distinct hour.",
    "5. File the confirmed tickets in `proposed` (`penguin org ticket create …`): one parent ticket for the project-level goal and children per stream. Assign an owner as you accept one into `in_progress` (`penguin org ticket assign <id> --owner agent:<employee>`): that employee's desk picks it up in its next sweep and starts the ticket session itself. Only a ticket's owner may start its sessions, so run `penguin org ticket start <id>` for the tickets you own yourself — the desk schedules and tracks, and never does the ticket work itself.",
    "6. Open one channel per stream (`penguin org channel create ch_<stream> --name …`) and invite its owner (`penguin org channel invite ch_<stream> agent:<agent_id>`), so a stream's thread does not drown the all-hands channel.",
    `7. Report to the board in the all-hands channel, mentioning @${board}, and name the next decision you need, if any.`,
  ].join("\n");
}

/** Next scheduled fire time, as the schedules route computes it. */
function calendarNextFireAt(
  def: ScheduleDefinition,
  state: {
    invalidReason: string | null;
    firedOnce: boolean;
    missed: boolean;
    lastSlotMs: number | null;
  } | null,
  nowMs: number,
): string | undefined {
  if (!def.enabled || state?.invalidReason) return undefined;
  if (def.periodMs === undefined && state && (state.firedOnce || state.missed)) return undefined;
  const due = latestSlotAt(def, nowMs);
  if (
    due !== null &&
    slotInWindow(def, due) &&
    (state === null || state.lastSlotMs === null || due > state.lastSlotMs)
  ) {
    return new Date(due).toISOString();
  }
  const next = nextSlotAfter(def, nowMs);
  return next !== null ? new Date(next).toISOString() : undefined;
}

function calendarStatus(
  def: ScheduleDefinition,
  state: { invalidReason: string | null; firedOnce: boolean; missed: boolean } | null,
  nowMs: number,
): ScheduleStatus {
  if (state?.invalidReason) return "invalid";
  if (def.periodMs === undefined && state?.firedOnce) return "done";
  if (def.periodMs === undefined && state?.missed) return "missed";
  if (def.endAtMs !== undefined && nowMs > def.endAtMs) return "expired";
  return def.enabled ? "active" : "disabled";
}
