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
  OrgChartResponse,
  OrgChatMessage,
  OrgChatResponse,
  OrgChatSendRequest,
  OrgDeskResponse,
  OrgEmployeeItem,
  OrgEmployeePatchRequest,
  OrgFinanceResponse,
  OrgHireRequest,
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
  ScheduleStatus,
} from "../../api/types.js";
import { HttpError } from "../../http/errors.js";
import { badRequest } from "../../http/validate.js";
import type { OrgConfig, OrgEmployee, TicketDoc } from "../../organization/files.js";
import {
  ORG_CONFIG_DEFAULTS,
  TICKET_ID_PATTERN,
  extractMentionTokens,
  parseCalendarEvent,
  parseOrgChart,
  parseProgressLine,
  progressLine,
  serializeCalendarEvent,
  serializeOrgChart,
  slugify,
} from "../../organization/files.js";
import { renderHandbook } from "../../organization/handbook.js";
import { ORG_TICKET_COLUMNS, ceoAgentId, isTicketColumn } from "../../organization/paths.js";
import {
  agentPrincipal,
  parsePrincipal,
  principalAgentId,
  splitPrincipalList,
  userPrincipal,
} from "../../organization/principal.js";
import { isValidTimeZone, zonedDate, zonedDayRange } from "../../organization/zoned.js";
import { SEMANTIC_ID_PATTERN } from "../../services/ids.js";
import { latestSlotAt, nextSlotAfter, slotInWindow } from "../schedule-file.js";
import type { ScheduleDefinition } from "../schedule-file.js";
import { budgetLine, computeSpend, pausedEmployees } from "./budget.js";
import type { OrgSpend } from "./budget.js";
import type { OrgDeps } from "./deps.js";
import { loadOrg } from "./model.js";
import type { LoadedOrg } from "./model.js";
import { appendChatMessage, listTickets, syncCaches } from "./reconcile.js";
import type { LoadedTicket } from "./reconcile.js";
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
    };
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
    const chat = await this.chat(projectId, orgId, userId, {});
    const me = userPrincipal(userId);
    const items = this.ticketItems(org, tickets, spend);
    const ceoDesk = org.desks[ceoAgentId(orgId)];
    return {
      ...summary,
      settings: this.settings(org),
      board,
      today,
      pending: {
        mentions: chat.mentionsMe,
        reviewTickets: items.filter((t) => t.status === "review"),
        blockedByMe: items.filter((t) => t.blockedBy === me),
      },
      recentChat: chat.messages.slice(-20),
      alerts: this.alerts(org, spend.period),
      ...(ceoDesk !== undefined ? { ceoDeskSessionId: ceoDesk.sessionId } : {}),
    };
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
    const config: OrgConfig = {
      name,
      mission,
      status: "active",
      timezone,
      approvalMode: ORG_CONFIG_DEFAULTS.approvalMode,
      mentionChainLimit: ORG_CONFIG_DEFAULTS.mentionChainLimit,
      budgetWarnRatio: ORG_CONFIG_DEFAULTS.budgetWarnRatio,
      budgetPauseRatio: ORG_CONFIG_DEFAULTS.budgetPauseRatio,
      createdBy: userId,
    };
    const dir = this.deps.store.dir(projectId, orgId);
    await this.deps.store.createLayout(dir);
    try {
      await this.deps.store.writeConfig(dir, config);
      await this.deps.store.writeChart(dir, {
        employees: [
          {
            agentId: ceo,
            title: "CEO",
            reportsTo: null,
            duties:
              "Turn the mission into tickets, hire, partition the shared workspace, review tickets, report to the board",
            workspace: ".",
          },
        ],
      });
      await this.deps.store.writeHandbook(
        dir,
        renderHandbook({ orgId, name, mission, ceoAgentId: ceo, createdBy: userId }),
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
        employeeBrief({ orgId, name, mission, agentId: ceo, title: "CEO", reportsTo: null }),
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
      if (org.invalid !== undefined && !org.invalid.startsWith("org_chart")) {
        // A broken config is rewritten whole from the request over the defaults.
      }
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
      if (req.mentionChainLimit !== undefined) next.mentionChainLimit = req.mentionChainLimit;
      if (req.budgetWarnRatio !== undefined) next.budgetWarnRatio = req.budgetWarnRatio;
      if (req.budgetPauseRatio !== undefined) next.budgetPauseRatio = req.budgetPauseRatio;
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
    for (const e of org.chart.employees) {
      const exists = await this.deps.agents.exists(org.projectId, e.agentId);
      const workspace = await this.deps.store.resolveWorkspace(org.dir, e.workspace);
      const invalid = !exists
        ? `Agent ${e.agentId} does not exist`
        : workspace === null
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
        workspace: req.workspace?.trim() || ".",
        ...(req.budget !== undefined ? { budget: req.budget } : {}),
        ...(req.model !== undefined ? { model: req.model } : {}),
      };
      await this.writeChart(org, [...org.chart.employees, employee]);
      await appendChatMessage(this.deps, org, {
        sender: "system",
        hop: 0,
        text: `${agentPrincipal(agentId)} joined as ${title}, reporting to ${agentPrincipal(req.reportsTo)}.`,
        mentions: [],
      });
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
        ...(req.workspace !== undefined ? { workspace: req.workspace.trim() || "." } : {}),
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
      for (const f of await this.deps.store.listCalendar(org.dir)) {
        if (f.agentId === agentId)
          await this.deps.store.deleteCalendarEvent(org.dir, agentId, f.name);
      }
      await appendChatMessage(this.deps, org, {
        sender: "system",
        hop: 0,
        text: `${agentPrincipal(agentId)} left the organization; reports now go to ${agentPrincipal(manager)}.`,
        mentions: [],
      });
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
  ): Promise<OrgCalendarItem> {
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
    const list = await this.calendar(projectId, orgId);
    const item = list.events.find((e) => e.agentId === agentId && e.name === name);
    if (!item)
      throw new HttpError(
        404,
        "calendar_event_not_found",
        `Calendar event does not exist: ${agentId}/${name}`,
      );
    return item;
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

  private ticketItem(org: LoadedOrg, t: LoadedTicket, spend: OrgSpend): OrgTicketItem {
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
      ...(d.parent !== undefined && !this.hasTicket(org, d.parent)
        ? { invalid: `Parent ${d.parent} does not exist` }
        : {}),
    };
  }

  private knownTicketIds: Map<string, Set<string>> = new Map();

  private hasTicket(org: LoadedOrg, ticketId: string): boolean {
    return this.knownTicketIds.get(`${org.projectId}\0${org.orgId}`)?.has(ticketId) ?? true;
  }

  private ticketItems(
    org: LoadedOrg,
    tickets: readonly LoadedTicket[],
    spend: OrgSpend,
  ): OrgTicketItem[] {
    this.knownTicketIds.set(
      `${org.projectId}\0${org.orgId}`,
      new Set(tickets.map((t) => t.ticketId)),
    );
    return tickets.map((t) => this.ticketItem(org, t, spend));
  }

  async tickets(projectId: string, orgId: string): Promise<OrgTicketsResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const { tickets, invalid } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    const columns = Object.fromEntries(
      ORG_TICKET_COLUMNS.map((c) => [c, [] as OrgTicketItem[]]),
    ) as Record<OrgTicketStatus, OrgTicketItem[]>;
    for (const item of this.ticketItems(org, tickets, spend)) columns[item.status].push(item);
    return { columns, invalidFiles: invalid };
  }

  private async ticketDetail(org: LoadedOrg, ticketId: string): Promise<OrgTicketDetail> {
    const { tickets } = await listTickets(this.deps, org);
    const spend = await computeSpend(this.deps, org, tickets);
    this.ticketItems(org, tickets, spend);
    const t = tickets.find((x) => x.ticketId === ticketId);
    if (!t) throw ticketNotFound(ticketId);
    const item = this.ticketItem(org, t, spend);
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
      const initiator = this.actorPrincipal(org, actor);
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
        notify: notify.length > 0 ? notify : [initiator],
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
        d.notify = notify.length > 0 ? notify : [d.initiator];
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
        ),
      );
      await this.deps.store.writeTicket(org.dir, ticketId, t.column, d);
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
      await this.deps.store.moveTicket(org.dir, ticketId, from, status, d);
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
      await this.deps.store.writeTicket(org.dir, ticketId, t.column, t.doc);
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

  async startTicket(
    projectId: string,
    orgId: string,
    ticketId: string,
    req: { agentId?: string; message?: string; workspace?: string },
  ): Promise<{ sessionId: string }> {
    const sessionId = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireValidOrg(projectId, orgId);
      const t = await this.requireTicket(org, ticketId);
      const agentId =
        req.agentId ?? (t.doc.owner !== undefined ? principalAgentId(t.doc.owner) : null);
      if (agentId === null || agentId === undefined) {
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
  // Chat
  // ---------------------------------------------------------------------------

  async chat(
    projectId: string,
    orgId: string,
    userId: string,
    opts: { date?: string },
  ): Promise<OrgChatResponse> {
    const org = await this.requireOrg(projectId, orgId);
    const days = await this.deps.store.listChatDays(org.dir);
    const today = zonedDate(org.config.timezone, this.now());
    const date = opts.date ?? today;
    const messages = (await this.deps.store.readChatDay(org.dir, date)).messages;
    const lastReadId = this.deps.cache.readCursor(projectId, orgId, userId);
    const me = userPrincipal(userId);
    let unread = 0;
    let mentionsMe = 0;
    for (const d of days.slice(0, 7)) {
      const list = d === date ? messages : (await this.deps.store.readChatDay(org.dir, d)).messages;
      for (const m of list) {
        if (lastReadId !== null && m.id <= lastReadId) continue;
        unread++;
        if (m.mentions.includes(me)) mentionsMe++;
      }
    }
    return {
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
    const project = this.deps.projects.findById(org.projectId);
    const users = new Set<string>([
      ...(project ? [project.ownerUserId] : []),
      ...this.deps.members.list(org.projectId).map((m) => m.userId),
    ]);
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

  async sendChat(
    projectId: string,
    orgId: string,
    userId: string,
    req: OrgChatSendRequest,
  ): Promise<OrgChatMessage> {
    const msg = await this.scheduler.withLock(projectId, orgId, async () => {
      const org = await this.requireOrg(projectId, orgId);
      const text = req.text.trim();
      if (text === "") throw badRequest("text must not be empty.");
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
      const refs = req.refs;
      return appendChatMessage(this.deps, org, {
        sender,
        hop,
        text,
        mentions: this.resolveMentions(org, text),
        ...(refs !== undefined && Object.keys(refs).length > 0 ? { refs } : {}),
      });
    });
    await this.scheduler.reconcile(projectId, orgId);
    return msg;
  }

  async markRead(projectId: string, orgId: string, userId: string, upTo: string): Promise<void> {
    await this.requireOrg(projectId, orgId);
    const current = this.deps.cache.readCursor(projectId, orgId, userId);
    if (current === null || upTo > current)
      this.deps.cache.setReadCursor(projectId, orgId, userId, upTo);
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

/** The AGENTS.md written for an Agent created as an employee: who it is in this organization and where the handbook is. */
export function employeeBrief(input: {
  orgId: string;
  name: string;
  mission: string;
  agentId: string;
  title: string;
  reportsTo: string | null;
  duties?: string;
}): string {
  return `# Employee brief

You are \`${input.agentId}\`, ${input.title} of the organization **${input.name}** (\`${input.orgId}\`), reporting to ${input.reportsTo === null ? "the board" : `\`${input.reportsTo}\``}.

Mission: ${input.mission}
${input.duties !== undefined ? `\nDuties: ${input.duties}\n` : ""}
Your organization directory is \`<app_data_dir>/organizations/${input.orgId}/\`. At the start of every work run read its \`README.md\` (the handbook), then follow the \`company-employee\` skill; use \`company-ceo\`, \`company-hr\` or \`company-finance\` when your title is that role. Inside your sessions the \`penguin org\` commands already know your organization, Project, Agent and session from the environment.
`;
}

/** The body of the CEO's initialization work run. */
function initBody(org: LoadedOrg): string {
  const board = userPrincipal(org.config.createdBy);
  return [
    `Mission: ${org.config.mission}`,
    "",
    "You are the CEO of a brand-new organization and this is its initialization run. Work through the following, in order, and report as you go:",
    `1. Read the handbook, then confirm your understanding of the mission with the board (${board}) in the group chat (\`penguin org chat send -m "@${board} …"\`) and ask what is unclear.`,
    `2. Hire HR and finance first — \`penguin org hire --new-agent ${org.orgId}_hr --title HR --reports-to ${ceoAgentId(org.orgId)} --duties "…"\` and the same for \`${org.orgId}_finance\` — then the roles the mission needs.`,
    "3. Partition the shared workspace: create sub-directories with your file tools and assign them (`penguin org employee set <agent_id> --workspace <sub-directory>`).",
    "4. Put yourself, HR and finance on the calendar (`penguin org calendar add …`): a daily sweep each is a good start.",
    "5. Turn the mission into a first batch of tickets in `proposed` (`penguin org ticket create …`), one parent ticket for the project-level goal and children per stream.",
    `6. Report to the board in the group chat, mentioning @${board}.`,
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

export { splitPrincipalList };
