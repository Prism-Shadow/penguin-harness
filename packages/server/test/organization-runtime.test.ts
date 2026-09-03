/**
 * Organization runtime semantics with doubles and a controlled clock — no real LLM, no
 * core Session: creation writes the files and opens the CEO's desk with an init run; a
 * calendar event registered after its time is not backfilled and fires on its next slot to
 * the employee's desk (queued when busy, held when the organization or the employee is
 * paused, held silently when the master switch is off); ticket changes are noticed once;
 * channel mentions reach desks and the chain stops at the limit; budgets warn, pause and resume.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseOrgTriggerMessage, saveProjectConfig } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { MembersRepo } from "../src/db/repos/members.js";
import { OrgCacheRepo } from "../src/db/repos/organizations.js";
import { ProjectsRepo } from "../src/db/repos/projects.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { UsersRepo } from "../src/db/repos/users.js";
import { OrgStore } from "../src/organization/store.js";
import { parseChannelConfig, serializeCalendarEvent } from "../src/organization/files.js";
import { DEFAULT_CHANNEL_ID } from "../src/organization/paths.js";
import { zonedDate } from "../src/organization/zoned.js";
import type { ErrorRecordArgs } from "../src/runtime/error-recorder.js";
import type { OrgDeps } from "../src/runtime/organization/deps.js";
import { OrganizationScheduler } from "../src/runtime/organization/scheduler.js";
import { OrganizationService } from "../src/runtime/organization/service.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { ServerEvent } from "../src/api/types.js";
import { makeTempRoot } from "./helpers.js";

const P = "p1";
const ORG = "acme";
const CEO = "acme_ceo";
const HR = "acme_hr";
const T0 = Date.parse("2026-09-01T01:00:00Z");
const DAY = 86_400_000;

interface Started {
  sessionId: string;
  text: string;
  queueIfBusy: boolean;
}

function textOf(input: OmniMessage[]): string {
  const first = input[0] as { payload?: { text?: string } } | undefined;
  return first?.payload?.text ?? "";
}

describe("organization runtime", () => {
  let root: string;
  let db: ReturnType<typeof openDatabase>;
  let sessions: SessionsRepo;
  let cache: OrgCacheRepo;
  let store: OrgStore;
  let nowMs: number;
  let busy: Set<string>;
  let started: Started[];
  let created: Array<{ projectId: string; agentId: string; workspace?: string }>;
  let agentsCreated: Array<{ agentId: string; plugins: readonly string[] }>;
  let briefs: Map<string, string>;
  let costs: Map<string, number>;
  let events: ServerEvent[];
  let errors: ErrorRecordArgs[];
  let companyMode: boolean;
  let scheduler: OrganizationScheduler;
  let service: OrganizationService;
  let seq: number;

  beforeEach(async () => {
    root = await makeTempRoot();
    await saveProjectConfig(root, P, {
      default_model: { provider: "custom", model_id: "m-bench" },
      models: [{ provider: "custom", model_id: "m-bench" }],
    });
    db = openDatabase(":memory:");
    new UsersRepo(db).insert({
      userId: "alice",
      passwordHash: "x",
      isAdmin: false,
      passwordIsInitial: false,
      createdAt: "2026-08-01T00:00:00Z",
    });
    const projects = new ProjectsRepo(db);
    projects.insert({ projectId: P, ownerUserId: "alice", createdAt: "2026-08-01T00:00:00Z" });
    sessions = new SessionsRepo(db);
    cache = new OrgCacheRepo(db);
    store = new OrgStore(root);
    nowMs = T0;
    busy = new Set();
    started = [];
    created = [];
    agentsCreated = [];
    briefs = new Map();
    costs = new Map();
    events = [];
    errors = [];
    companyMode = true;
    seq = 0;
    const existingAgents = new Set<string>();
    const deps: OrgDeps = {
      root,
      store,
      cache,
      projects,
      members: new MembersRepo(db),
      sessions,
      runner: {
        statusOf: (id) => (busy.has(id) ? "running" : "idle"),
        startTask: async (sessionId, input, opts) => {
          started.push({ sessionId, text: textOf(input), queueIfBusy: opts?.queueIfBusy === true });
          return { sessionId, queued: busy.has(sessionId) };
        },
      },
      sessionCreator: {
        createSession: async (args) => {
          seq++;
          const sessionId = `session-2026-09-01-00-00-0${seq}-0000000${seq}`;
          created.push({
            projectId: args.projectId,
            agentId: args.agentId,
            ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
          });
          const createdAt = new Date(nowMs).toISOString();
          sessions.insert({
            sessionId,
            projectId: args.projectId,
            agentId: args.agentId,
            provider: args.provider ?? "custom",
            modelId: args.modelId ?? "m-bench",
            workspace: args.workspace ?? root,
            approvalMode: args.approvalMode ?? "allow-all",
            title: null,
            client: "web",
            lastActiveAt: createdAt,
            createdAt,
          });
          return { sessionId, workspace: args.workspace ?? root };
        },
      },
      agents: {
        exists: async (_p, agentId) => existingAgents.has(agentId),
        create: async (_p, agentId, _name, _description, plugins) => {
          existingAgents.add(agentId);
          agentsCreated.push({ agentId, plugins });
        },
        displayName: async (_p, agentId) => `Name of ${agentId}`,
        writeAgentsMd: async (_p, agentId, content) => {
          briefs.set(agentId, content);
        },
      },
      projectConfig: new ProjectConfigService(root),
      usage: {
        costBySession: async (_p, ids) => ({
          bySession: new Map(ids.filter((id) => costs.has(id)).map((id) => [id, costs.get(id)!])),
          unpriced: false,
        }),
        dailyCostForSessions: async () => [],
      },
      errors: { record: (e) => void errors.push(e) },
      notifyProject: (_p, event) => void events.push(event),
      companyModeEnabled: () => companyMode,
      now: () => nowMs,
      log: () => {},
    };
    scheduler = new OrganizationScheduler(deps, { intervalMs: 1_000_000 });
    service = new OrganizationService(deps, scheduler);
  });

  async function createOrg(): Promise<void> {
    await service.create(
      P,
      {
        orgId: ORG,
        name: "Acme",
        mission: "Build a plugin marketplace",
        timezone: "Asia/Shanghai",
      },
      "alice",
    );
  }

  const orgDir = (): string => store.dir(P, ORG);

  it("keeps the knowledge base under handbook/: the index first, documents by path, the index undeletable", async () => {
    await createOrg();
    const index = await service.handbook(P, ORG);
    expect(index).toContain("## Knowledge base");
    expect(index).toContain("## Documents");

    await service.writeHandbookFile(P, ORG, "decisions/2026-09-02-hire-plan.md", "# Hire plan\n");
    await service.writeHandbookFile(P, ORG, "conventions.md", "# Conventions\n");
    const listed = (await service.handbookFiles(P, ORG)).files.map((f) => f.path);
    expect(listed).toEqual(["README.md", "conventions.md", "decisions/2026-09-02-hire-plan.md"]);
    expect(await service.handbookFile(P, ORG, "decisions/2026-09-02-hire-plan.md")).toEqual({
      path: "decisions/2026-09-02-hire-plan.md",
      content: "# Hire plan\n",
    });

    await expect(service.handbookFile(P, ORG, "../org_config.toml")).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.writeHandbookFile(P, ORG, ".hidden.md", "x")).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.deleteHandbookFile(P, ORG, "README.md")).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.deleteHandbookFile(P, ORG, "missing.md")).rejects.toMatchObject({
      status: 404,
    });

    await service.deleteHandbookFile(P, ORG, "decisions/2026-09-02-hire-plan.md");
    await expect(fs.stat(path.join(orgDir(), "handbook", "decisions"))).rejects.toBeTruthy();
    expect((await service.handbookFiles(P, ORG)).files.map((f) => f.path)).toEqual([
      "README.md",
      "conventions.md",
    ]);
  });

  it("creation writes the files, the CEO with its plugins and brief, and opens the desk with an init run", async () => {
    await createOrg();
    const dir = orgDir();
    for (const f of [
      "org_config.toml",
      "org_chart.yaml",
      "handbook/README.md",
      "desks.toml",
      "calendar",
      "tickets",
      "channels",
      "channels/default_channel/channel.toml",
      "workspace",
    ]) {
      await expect(fs.stat(path.join(dir, f))).resolves.toBeTruthy();
    }
    // The all-hands channel is created with the organization and belongs to everyone.
    const allChannel = parseChannelConfig(
      DEFAULT_CHANNEL_ID,
      await fs.readFile(path.join(dir, "channels", DEFAULT_CHANNEL_ID, "channel.toml"), "utf8"),
    );
    expect(allChannel).toMatchObject({
      ok: true,
      value: { name: "All hands", createdBy: "system", everyone: true, archived: false },
    });
    expect(agentsCreated).toEqual([
      { agentId: CEO, plugins: ["agent-company", "agent-development"] },
    ]);
    expect(briefs.get(CEO)).toContain(`<app_data_dir>/organizations/${ORG}/`);
    expect(created).toHaveLength(1);
    expect(created[0]!.workspace).toBe(path.join(dir, "workspace"));
    expect(started).toHaveLength(1);
    const parsed = parseOrgTriggerMessage(started[0]!.text);
    expect(parsed?.origin.kind).toBe("init");
    expect(parsed?.origin.org).toBe(ORG);
    expect(parsed?.rest).toContain("Mission: Build a plugin marketplace");
    // The board decides: the init run proposes and stops before hiring anything.
    expect(parsed?.rest).toContain("END THIS RUN");
    expect(parsed?.rest).toContain("@user:alice");
    expect(sessions.findById(started[0]!.sessionId)?.title).toBe(`Name of ${CEO} 的工位`);
    expect(cache.ownerOfSession(started[0]!.sessionId)).toMatchObject({
      orgId: ORG,
      agentId: CEO,
      kind: "desk",
    });
    expect(events.some((e) => e.type === "org_run" && e.kind === "init")).toBe(true);
    const detail = await service.detail(P, ORG, "alice");
    expect(detail.employeeCount).toBe(1);
    expect(detail.ceoDeskSessionId).toBe(started[0]!.sessionId);
  });

  it("uses the chosen shared workspace and model for desks and ticket sessions", async () => {
    const shared = path.join(root, "company-ws");
    await fs.mkdir(shared, { recursive: true });
    await service.create(
      P,
      {
        orgId: ORG,
        mission: "Build it",
        workspace: shared,
        model: { provider: "custom", modelId: "m-bench" },
      },
      "alice",
    );
    expect(created[0]!.workspace).toBe(shared);
    expect(sessions.findById(started[0]!.sessionId)?.modelId).toBe("m-bench");
    const detail = await service.detail(P, ORG, "alice");
    expect(detail.settings.workspace).toBe(shared);
    expect(detail.settings.model).toEqual({ provider: "custom", modelId: "m-bench" });
    // A sub-directory of the chosen root is what an employee's relative workspace resolves to.
    await fs.mkdir(path.join(shared, "site"));
    const item = await service.hire(P, ORG, {
      newAgent: { agentId: HR },
      title: "Dev",
      reportsTo: CEO,
      workspace: "site",
    });
    expect(item.resolvedWorkspace).toBe(path.join(shared, "site"));
    await expect(
      service.create(
        P,
        { orgId: "other", mission: "x", workspace: path.join(root, "missing") },
        "alice",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create(
        P,
        { orgId: "other", mission: "x", model: { provider: "custom", modelId: "nope" } },
        "alice",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a taken organization id and cleans up when the CEO cannot be created", async () => {
    await createOrg();
    await expect(createOrg()).rejects.toMatchObject({ status: 409, code: "org_exists" });
    await expect(
      service.create(P, { orgId: "bad id", mission: "x" }, "alice"),
    ).rejects.toMatchObject({ code: "invalid_org_id" });
  });

  it("hires through the API, writes the chart and announces it in the all-hands channel", async () => {
    await createOrg();
    await fs.mkdir(path.join(orgDir(), "workspace", "people"));
    const item = await service.hire(P, ORG, {
      newAgent: { agentId: HR, name: "HR" },
      title: "HR",
      reportsTo: CEO,
      workspace: "people",
      budget: 10,
    });
    expect(item.agentId).toBe(HR);
    expect(item.resolvedWorkspace).toBe(path.join(orgDir(), "workspace", "people"));
    expect(agentsCreated.map((a) => a.agentId)).toEqual([CEO, HR]);
    const chart = await service.chart(P, ORG);
    expect(chart.employees.map((e) => e.agentId)).toEqual([CEO, HR]);
    const allHands = await service.channelMessages(
      P,
      ORG,
      { userId: "alice" },
      DEFAULT_CHANNEL_ID,
      {},
    );
    expect(
      allHands.messages.some(
        (m) => m.sender === "system" && m.text.includes("agent:acme_hr joined as HR"),
      ),
    ).toBe(true);
    await expect(
      service.hire(P, ORG, { agentId: HR, title: "Again", reportsTo: CEO }),
    ).rejects.toMatchObject({
      code: "employee_exists",
    });
    await expect(
      service.hire(P, ORG, { agentId: "ghost", title: "X", reportsTo: CEO }),
    ).rejects.toMatchObject({
      code: "agent_not_found",
    });
  });

  describe("calendar", () => {
    async function hireHr(): Promise<void> {
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
    }

    it("does not backfill a slot that passed before registration, then fires on the next one to the desk", async () => {
      await createOrg();
      await hireHr();
      started.length = 0;
      await store.writeCalendarEvent(
        orgDir(),
        HR,
        "sweep",
        serializeCalendarEvent({
          prompt: "Sweep the board",
          enabled: true,
          startAt: new Date(T0 - DAY).toISOString(),
          period: "1d",
        }),
      );
      await scheduler.tickOnce();
      expect(started).toHaveLength(0);
      const list = await service.calendar(P, ORG);
      expect(list.events[0]).toMatchObject({
        agentId: HR,
        name: "sweep",
        status: "active",
        paused: false,
      });
      expect(list.events[0]!.nextFireAt).toBe(new Date(T0 + DAY).toISOString());

      nowMs = T0 + DAY + 1000;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      const parsed = parseOrgTriggerMessage(started[0]!.text);
      expect(parsed?.origin).toMatchObject({
        kind: "event",
        event: "sweep",
        employee: `${HR} (HR, reports to ${CEO})`,
      });
      expect(parsed?.origin.budget).toBe("0.00 USD / unbounded");
      expect(parsed?.rest).toBe("Sweep the board");
      expect(started[0]!.queueIfBusy).toBe(true);
      expect(cache.ownerOfSession(started[0]!.sessionId)).toMatchObject({
        agentId: HR,
        kind: "desk",
      });
      const after = await service.calendar(P, ORG);
      expect(after.events[0]!.lastOutcome).toBe("fired");
      // The same slot never fires twice.
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
    });

    it("queues behind a busy desk, holds while paused, and consumes silently with the switch off", async () => {
      await createOrg();
      await hireHr();
      await store.writeCalendarEvent(
        orgDir(),
        HR,
        "sweep",
        serializeCalendarEvent({
          prompt: "Sweep",
          enabled: true,
          startAt: new Date(T0).toISOString(),
          period: "1d",
        }),
      );
      await scheduler.tickOnce(); // baseline
      started.length = 0;
      // Open the desk so it can be busy.
      const desk = await service.desk(P, ORG, HR, {});
      busy.add(desk.sessionId);
      nowMs = T0 + DAY + 1;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      expect((await service.calendar(P, ORG)).events[0]!.lastOutcome).toBe("queued");
      busy.clear();

      await service.patch(P, ORG, { status: "paused" });
      nowMs = T0 + 2 * DAY + 1;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      expect((await service.calendar(P, ORG)).events[0]!.lastOutcome).toBe("paused");
      expect((await service.calendar(P, ORG)).events[0]!.paused).toBe(true);
      await service.patch(P, ORG, { status: "active" });

      companyMode = false;
      nowMs = T0 + 3 * DAY + 1;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      companyMode = true;
      // The slot consumed while the switch was off is not backfilled once it is on again.
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      nowMs = T0 + 4 * DAY + 1;
      await scheduler.tickOnce();
      expect(started).toHaveLength(2);
    });

    it("reports an invalid file and one that belongs to nobody without firing", async () => {
      await createOrg();
      await store.writeCalendarEvent(orgDir(), CEO, "bad", 'prompt = ""\n');
      await store.writeCalendarEvent(
        orgDir(),
        "stranger",
        "sweep",
        serializeCalendarEvent({ prompt: "x", enabled: true, startAt: new Date(T0).toISOString() }),
      );
      started.length = 0;
      await scheduler.tickOnce();
      expect(started).toHaveLength(0);
      expect(errors.filter((e) => e.code === "org_calendar_invalid")).toHaveLength(2);
      const list = await service.calendar(P, ORG);
      expect(list.invalidFiles.map((f) => f.name).sort()).toEqual(["bad", "sweep"]);
    });
  });

  describe("tickets", () => {
    beforeEach(async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      started.length = 0;
      events.length = 0;
    });

    it("creates in proposed with the initiator, notices the owner, and opens ticket sessions that contribute", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Launch the site", goal: "Ship it", owner: `agent:${HR}`, priority: "P1" },
        { userId: "alice" },
      );
      expect(t.ticketId).toMatch(/^2026-09-01-launch-the-site$/);
      expect(t.status).toBe("proposed");
      expect(t.initiator).toBe("user:alice");
      expect(t.notify).toEqual(["user:alice"]);
      await expect(
        fs.stat(path.join(orgDir(), "tickets", "2026-09", "proposed", `${t.ticketId}.md`)),
      ).resolves.toBeTruthy();
      // Assignment at creation reaches the owner's desk once.
      const notices = started
        .map((s) => parseOrgTriggerMessage(s.text)?.origin)
        .filter((o) => o?.kind === "ticket_notice");
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ ticket: t.ticketId, change: "assigned" });
      await scheduler.tickOnce();
      expect(
        started.filter((s) => parseOrgTriggerMessage(s.text)?.origin.kind === "ticket_notice"),
      ).toHaveLength(1);

      const { sessionId } = await service.startTicket(P, ORG, t.ticketId, {
        message: "Start with the scaffold",
      });
      const detail = await service.ticket(P, ORG, t.ticketId);
      expect(detail.sessions).toEqual([sessionId]);
      expect(sessions.findById(sessionId)?.title).toBe("Launch the site #1");
      expect(cache.ownerOfSession(sessionId)).toMatchObject({ kind: "ticket", agentId: HR });
      const work = started.find((s) => s.sessionId === sessionId);
      expect(parseOrgTriggerMessage(work!.text)?.origin).toMatchObject({
        kind: "ticket_work",
        ticket: t.ticketId,
      });
      expect(work!.text).toContain("Note from the desk: Start with the scaffold");
      expect(work!.text).toContain("# Ticket: Launch the site");

      // A second session for the same ticket, and progress written from inside it.
      const second = await service.startTicket(P, ORG, t.ticketId, {});
      expect((await service.ticket(P, ORG, t.ticketId)).sessions).toEqual([
        sessionId,
        second.sessionId,
      ]);
      const withProgress = await service.progressTicket(P, ORG, t.ticketId, "half done", {
        userId: "alice",
        sessionId,
      });
      const last = withProgress.progress.at(-1)!;
      expect(last).toMatchObject({ by: `agent:${HR}`, text: "half done", sessionId });
    });

    it("moves between columns, notifies on done, and rejects need a reason", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Write docs", owner: `agent:${HR}`, notify: [`agent:${CEO}`] },
        { userId: "alice" },
      );
      started.length = 0;
      await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, { userId: "alice" });
      await expect(
        fs.stat(path.join(orgDir(), "tickets", "2026-09", "in_progress", `${t.ticketId}.md`)),
      ).resolves.toBeTruthy();
      await expect(
        fs.stat(path.join(orgDir(), "tickets", "2026-09", "proposed", `${t.ticketId}.md`)),
      ).rejects.toBeTruthy();
      await expect(
        service.moveTicket(P, ORG, t.ticketId, "rejected", undefined, { userId: "alice" }),
      ).rejects.toMatchObject({ status: 400 });
      await service.moveTicket(P, ORG, t.ticketId, "done", undefined, { userId: "alice" });
      const notices = started
        .map((s) => parseOrgTriggerMessage(s.text)?.origin)
        .filter((o) => o?.kind === "ticket_notice");
      // Notify = CEO (agent) and the initiator alice (user): the CEO's desk gets a notice, alice a system line.
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        ticket: t.ticketId,
        change: "done",
        employee: `${CEO} (CEO)`,
      });
      const allHands = await service.channelMessages(
        P,
        ORG,
        { userId: "alice" },
        DEFAULT_CHANNEL_ID,
        {},
      );
      const line = allHands.messages.find(
        (m) => m.sender === "system" && m.text.includes(t.ticketId),
      );
      expect(line?.mentions).toEqual(["user:alice"]);
      expect(events.some((e) => e.type === "org_ticket" && e.change === "status:done")).toBe(true);
      const board = await service.tickets(P, ORG);
      expect(board.columns.done.map((x) => x.ticketId)).toEqual([t.ticketId]);
    });

    it("blocking notices the blocker and the owner's manager; closing the blocker tells the owner", async () => {
      const blocker = await service.createTicket(
        P,
        ORG,
        { title: "Buy the domain" },
        { userId: "alice" },
      );
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Launch", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      started.length = 0;
      await service.blockTicket(P, ORG, t.ticketId, "Waiting for the domain", blocker.ticketId, {
        userId: "alice",
      });
      const detail = await service.ticket(P, ORG, t.ticketId);
      expect(detail.blocked).toBe("Waiting for the domain");
      expect(detail.blockedBy).toBe(blocker.ticketId);
      let notices = started
        .map((s) => parseOrgTriggerMessage(s.text)?.origin)
        .filter((o) => o?.kind === "ticket_notice");
      // HR's manager is the CEO.
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        change: "blocked",
        ticket: t.ticketId,
        employee: `${CEO} (CEO)`,
      });
      started.length = 0;
      await service.moveTicket(P, ORG, blocker.ticketId, "done", undefined, { userId: "alice" });
      notices = started
        .map((s) => parseOrgTriggerMessage(s.text)?.origin)
        .filter((o) => o?.kind === "ticket_notice");
      expect(notices.some((n) => n?.change === "blocker_closed" && n.ticket === t.ticketId)).toBe(
        true,
      );
      await service.unblockTicket(P, ORG, t.ticketId, { userId: "alice" });
      expect((await service.ticket(P, ORG, t.ticketId)).blocked).toBeUndefined();
      const board = await service.tickets(P, ORG);
      expect(
        board.columns.proposed.find((x) => x.ticketId === t.ticketId)?.blocked,
      ).toBeUndefined();
    });
  });

  describe("channel messages", () => {
    beforeEach(async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      started.length = 0;
    });

    it("delivers mentions to desks, records the rest, and stops the chain at the limit", async () => {
      const m1 = await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "@acme_hr welcome, and @nobody too",
      });
      expect(m1.sender).toBe("user:alice");
      expect(m1.hop).toBe(0);
      expect(m1.mentions).toEqual([`agent:${HR}`]);
      expect(started).toHaveLength(1);
      const first = parseOrgTriggerMessage(started[0]!.text);
      expect(first?.origin).toMatchObject({ kind: "mention", message: `${m1.id} from user:alice` });
      expect(first?.rest).toContain("welcome");
      const hrDesk = started[0]!.sessionId;

      // HR answers from its desk: hop 1, delivered to the CEO.
      const m2 = await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: `@${CEO} done`,
        sessionId: hrDesk,
      });
      expect(m2.sender).toBe(`agent:${HR}`);
      expect(m2.hop).toBe(1);
      expect(started).toHaveLength(2);
      const ceoDesk = started[1]!.sessionId;
      expect(cache.ownerOfSession(ceoDesk)?.agentId).toBe(CEO);

      // CEO replies: hop 2, delivered to HR; HR replies: hop 3 = the limit, recorded only.
      const m3 = await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: `@${HR} thanks`,
        sessionId: ceoDesk,
      });
      expect(m3.hop).toBe(2);
      expect(started).toHaveLength(3);
      const m4 = await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: `@${CEO} anytime`,
        sessionId: hrDesk,
      });
      expect(m4.hop).toBe(3);
      expect(m4.mentions).toEqual([`agent:${CEO}`]);
      expect(started).toHaveLength(3);

      // A plain message reaches nobody; @all reaches everyone but the sender.
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "just noting",
      });
      expect(started).toHaveLength(3);
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "@all standup in 5",
      });
      expect(started).toHaveLength(5);

      const allHands = await service.channelMessages(
        P,
        ORG,
        { userId: "alice" },
        DEFAULT_CHANNEL_ID,
        {},
      );
      expect(allHands.messages.map((m) => m.id)).toContain(m1.id);
      expect(allHands.unread).toBeGreaterThanOrEqual(6);
      await service.markRead(P, ORG, "alice", DEFAULT_CHANNEL_ID, allHands.messages.at(-1)!.id);
      expect(
        (await service.channelMessages(P, ORG, { userId: "alice" }, DEFAULT_CHANNEL_ID, {})).unread,
      ).toBe(0);
    });

    it("the system's own lines and a paused organization deliver nothing", async () => {
      await service.patch(P, ORG, { status: "paused" });
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: `@${HR} hello?`,
      });
      expect(started).toHaveLength(0);
    });
  });

  describe("channels", () => {
    const alice = { userId: "alice" };
    let ceoDesk: string;
    let hrDesk: string;
    const asCeo = (): { userId: string; sessionId: string } => ({
      userId: "alice",
      sessionId: ceoDesk,
    });
    const asHr = (): { userId: string; sessionId: string } => ({
      userId: "alice",
      sessionId: hrDesk,
    });

    beforeEach(async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      ceoDesk = (await service.desk(P, ORG, CEO, {})).sessionId;
      hrDesk = (await service.desk(P, ORG, HR, {})).sessionId;
      started.length = 0;
    });

    it("a new channel holds only its creator; the all-hands channel holds everyone", async () => {
      const site = await service.createChannel(
        P,
        ORG,
        { channelId: "site", name: "Site launch", purpose: "Ship the site" },
        alice,
      );
      expect(site).toMatchObject({
        channelId: "site",
        name: "Site launch",
        purpose: "Ship the site",
        everyone: false,
        archived: false,
        createdBy: "user:alice",
        memberCount: 1,
        isMember: true,
      });
      expect((await service.channel(P, ORG, "site", alice)).members).toEqual([
        { principal: "user:alice", name: "alice", kind: "user" },
      ]);
      const all = await service.channel(P, ORG, DEFAULT_CHANNEL_ID, alice);
      expect(all.everyone).toBe(true);
      expect(all.members.map((m) => m.principal).sort()).toEqual(
        [`agent:${CEO}`, `agent:${HR}`, "user:alice"].sort(),
      );
      expect(all.members.find((m) => m.principal === `agent:${CEO}`)?.name).toBe(`Name of ${CEO}`);

      await expect(
        service.createChannel(P, ORG, { channelId: "site" }, alice),
      ).rejects.toMatchObject({ status: 409, code: "channel_exists" });
      await expect(
        service.createChannel(P, ORG, { channelId: DEFAULT_CHANNEL_ID }, alice),
      ).rejects.toMatchObject({ code: "channel_exists" });
      await expect(
        service.createChannel(P, ORG, { channelId: "Site" }, alice),
      ).rejects.toMatchObject({ status: 400 });
      await expect(service.channel(P, ORG, "missing", alice)).rejects.toMatchObject({
        status: 404,
        code: "channel_not_found",
      });
    });

    it("an employee joins only by invitation; a person joins any channel itself", async () => {
      await service.createChannel(P, ORG, { channelId: "site" }, asCeo());
      expect(
        (await service.channel(P, ORG, "site", asCeo())).members.map((m) => m.principal),
      ).toEqual([`agent:${CEO}`]);
      await expect(
        service.addChannelMember(P, ORG, "site", `agent:${HR}`, asHr()),
      ).rejects.toMatchObject({ status: 403, code: "not_a_member" });
      await expect(service.channel(P, ORG, "site", asHr())).rejects.toMatchObject({
        status: 403,
        code: "not_a_member",
      });

      const joined = await service.addChannelMember(P, ORG, "site", "user:alice", alice);
      expect(joined.members.map((m) => m.principal)).toEqual([`agent:${CEO}`, "user:alice"]);
      const invited = await service.addChannelMember(P, ORG, "site", `agent:${HR}`, asCeo());
      expect(invited.members.map((m) => m.principal)).toEqual([
        `agent:${CEO}`,
        "user:alice",
        `agent:${HR}`,
      ]);
      expect(invited.memberCount).toBe(3);
      // Inviting twice is the same membership, not an error.
      expect(
        (await service.addChannelMember(P, ORG, "site", `agent:${HR}`, asCeo())).memberCount,
      ).toBe(3);

      for (const principal of ["agent:ghost", "user:mallory", "all"]) {
        await expect(
          service.addChannelMember(P, ORG, "site", principal, alice),
        ).rejects.toMatchObject({ status: 400, code: "invalid_principal" });
      }
      expect(
        (await service.channelMessages(P, ORG, alice, "site", {})).messages.map((m) => m.text),
      ).toEqual([
        `agent:${CEO} created the channel.`,
        "user:alice joined the channel.",
        `agent:${CEO} invited agent:${HR} to the channel.`,
      ]);
    });

    it("a member leaves; a person removes anyone; an employee removes only itself", async () => {
      await service.createChannel(P, ORG, { channelId: "site" }, alice);
      await service.addChannelMember(P, ORG, "site", `agent:${CEO}`, alice);
      await service.addChannelMember(P, ORG, "site", `agent:${HR}`, alice);
      await expect(
        service.removeChannelMember(P, ORG, "site", `agent:${CEO}`, asHr()),
      ).rejects.toMatchObject({ status: 403, code: "not_a_member" });

      await service.removeChannelMember(P, ORG, "site", `agent:${HR}`, asHr());
      expect(
        (await service.channel(P, ORG, "site", alice)).members.map((m) => m.principal),
      ).toEqual(["user:alice", `agent:${CEO}`]);
      // A person removes anyone, and removing a non-member changes nothing.
      await service.removeChannelMember(P, ORG, "site", `agent:${CEO}`, alice);
      await service.removeChannelMember(P, ORG, "site", `agent:${CEO}`, alice);
      expect(
        (await service.channel(P, ORG, "site", alice)).members.map((m) => m.principal),
      ).toEqual(["user:alice"]);
      const texts = (await service.channelMessages(P, ORG, alice, "site", {})).messages.map(
        (m) => m.text,
      );
      expect(texts).toContain(`agent:${HR} left the channel.`);
      expect(
        texts.filter((t) => t === `user:alice removed agent:${CEO} from the channel.`),
      ).toHaveLength(1);
    });

    it("archiving is a person's call, and an archived channel takes no writes", async () => {
      await service.createChannel(P, ORG, { channelId: "site" }, asCeo());
      await expect(
        service.patchChannel(P, ORG, "site", { archived: true }, asCeo()),
      ).rejects.toMatchObject({ status: 403, code: "not_a_member" });
      expect((await service.patchChannel(P, ORG, "site", { archived: true }, alice)).archived).toBe(
        true,
      );
      await expect(
        service.sendChannelMessage(P, ORG, "alice", "site", { text: "hi", sessionId: ceoDesk }),
      ).rejects.toMatchObject({ status: 409, code: "channel_archived" });
      await expect(
        service.addChannelMember(P, ORG, "site", `agent:${HR}`, alice),
      ).rejects.toMatchObject({ code: "channel_archived" });
      await expect(
        service.removeChannelMember(P, ORG, "site", `agent:${CEO}`, alice),
      ).rejects.toMatchObject({ code: "channel_archived" });
      await expect(
        service.patchChannel(P, ORG, "site", { name: "Nope" }, alice),
      ).rejects.toMatchObject({ code: "channel_archived" });
      // Lifting the archive is the one edit it accepts.
      expect(
        (await service.patchChannel(P, ORG, "site", { archived: false }, alice)).archived,
      ).toBe(false);
      const renamed = await service.patchChannel(P, ORG, "site", { name: "Site" }, asCeo());
      expect(renamed.name).toBe("Site");
      const texts = (await service.channelMessages(P, ORG, alice, "site", {})).messages.map(
        (m) => m.text,
      );
      expect(texts).toContain("user:alice archived the channel.");
      expect(texts).toContain("user:alice unarchived the channel.");
    });

    it("the all-hands channel cannot be archived, joined or left", async () => {
      for (const call of [
        () => service.patchChannel(P, ORG, DEFAULT_CHANNEL_ID, { archived: true }, alice),
        () => service.addChannelMember(P, ORG, DEFAULT_CHANNEL_ID, `agent:${HR}`, alice),
        () => service.removeChannelMember(P, ORG, DEFAULT_CHANNEL_ID, "user:alice", alice),
      ]) {
        await expect(call()).rejects.toMatchObject({ status: 400, code: "all_hands_immutable" });
      }
      // Renaming it is allowed; the UI renders its own label for it anyway.
      expect(
        (await service.patchChannel(P, ORG, DEFAULT_CHANNEL_ID, { name: "Everyone" }, alice)).name,
      ).toBe("Everyone");
    });

    it("delivers a mention inside the channel only, and refuses one that names an outsider", async () => {
      await service.createChannel(P, ORG, { channelId: "site" }, alice);
      await service.addChannelMember(P, ORG, "site", `agent:${CEO}`, alice);
      started.length = 0;

      await expect(
        service.sendChannelMessage(P, ORG, "alice", "site", { text: "hello", sessionId: hrDesk }),
      ).rejects.toMatchObject({ status: 403, code: "not_a_member" });
      await expect(
        service.sendChannelMessage(P, ORG, "alice", "site", { text: `@${HR} look at this` }),
      ).rejects.toMatchObject({
        status: 400,
        code: "mention_not_member",
        message: expect.stringContaining(`agent:${HR}`),
      });
      // Nothing was written and nobody was woken.
      expect(
        (await service.channelMessages(P, ORG, alice, "site", {})).messages.filter(
          (m) => m.sender !== "system",
        ),
      ).toEqual([]);
      expect(started).toHaveLength(0);

      const msg = await service.sendChannelMessage(P, ORG, "alice", "site", {
        text: "@all kickoff",
      });
      expect(started).toHaveLength(1);
      expect(started[0]!.sessionId).toBe(ceoDesk);
      const parsed = parseOrgTriggerMessage(started[0]!.text);
      expect(parsed?.origin).toMatchObject({
        kind: "mention",
        channel: "site",
        message: `${msg.id} from user:alice`,
      });
      expect(parsed?.rest).toContain("kickoff");
      expect(
        events.some(
          (e) => e.type === "org_channel" && e.channelId === "site" && e.message.id === msg.id,
        ),
      ).toBe(true);

      // The same `@all` in the all-hands channel is every employee.
      started.length = 0;
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "@all standup",
      });
      expect(started.map((s) => s.sessionId).sort()).toEqual([ceoDesk, hrDesk].sort());
      expect(parseOrgTriggerMessage(started[0]!.text)?.origin.channel).toBe(DEFAULT_CHANNEL_ID);
    });

    it("counts unread per channel and shows an employee only the channels it is in", async () => {
      await service.createChannel(P, ORG, { channelId: "site" }, alice);
      await service.addChannelMember(P, ORG, "site", `agent:${CEO}`, alice);
      const ping = await service.sendChannelMessage(P, ORG, "alice", "site", {
        text: "@user:alice ping",
        sessionId: ceoDesk,
      });
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, { text: "plain line" });

      const listed = await service.channels(P, ORG, alice);
      expect(listed.channels.map((c) => c.channelId)).toEqual([DEFAULT_CHANNEL_ID, "site"]);
      const byId = new Map(listed.channels.map((c) => [c.channelId, c]));
      expect(byId.get("site")).toMatchObject({ isMember: true, memberCount: 2, mentionsMe: 1 });
      expect(byId.get("site")!.lastMessageAt).toBe(ping.time);
      expect(byId.get(DEFAULT_CHANNEL_ID)).toMatchObject({ mentionsMe: 0, memberCount: 3 });
      expect(byId.get(DEFAULT_CHANNEL_ID)!.unread).toBeGreaterThan(0);

      // Reading one channel leaves the other's cursor where it was.
      const site = await service.channelMessages(P, ORG, alice, "site", {});
      expect(site.channelId).toBe("site");
      await service.markRead(P, ORG, "alice", "site", site.messages.at(-1)!.id);
      const after = new Map(
        (await service.channels(P, ORG, alice)).channels.map((c) => [c.channelId, c]),
      );
      expect(after.get("site")).toMatchObject({ unread: 0, mentionsMe: 0 });
      expect(after.get(DEFAULT_CHANNEL_ID)!.unread).toBeGreaterThan(0);

      expect((await service.channels(P, ORG, asHr())).channels.map((c) => c.channelId)).toEqual([
        DEFAULT_CHANNEL_ID,
      ]);
      const ceoView = await service.channels(P, ORG, asCeo());
      expect(ceoView.channels.map((c) => c.channelId)).toEqual([DEFAULT_CHANNEL_ID, "site"]);
      // An employee has no read cursor of its own; it reads through its triggers.
      expect(
        ceoView.channels.every((c) => c.isMember && c.unread === 0 && c.mentionsMe === 0),
      ).toBe(true);
      await expect(service.channelMessages(P, ORG, asHr(), "site", {})).rejects.toMatchObject({
        status: 403,
        code: "not_a_member",
      });
    });

    it("ignores a stray entry under channels/ and reports a channel whose file does not parse", async () => {
      // A directory without a channel.toml, and a plain file, are not channels.
      await fs.writeFile(path.join(orgDir(), "channels", "notes.md"), "scratch\n", "utf8");
      await fs.mkdir(path.join(orgDir(), "channels", "empty"), { recursive: true });
      await fs.mkdir(path.join(orgDir(), "channels", "broken"), { recursive: true });
      await fs.writeFile(
        path.join(orgDir(), "channels", "broken", "channel.toml"),
        'name = "Broken"\n',
        "utf8",
      );
      errors.length = 0;
      await scheduler.tickOnce();
      expect((await service.channels(P, ORG, alice)).channels.map((c) => c.channelId)).toEqual([
        DEFAULT_CHANNEL_ID,
      ]);
      expect(errors.filter((e) => e.code === "org_channel_invalid")).toHaveLength(1);
      await expect(service.channel(P, ORG, "broken", alice)).rejects.toMatchObject({
        status: 404,
        code: "channel_not_found",
      });
    });
  });

  describe("budgets", () => {
    it("warns once, pauses the employee's calendar and its subordinates, and resumes when the budget is raised", async () => {
      await createOrg();
      await service.hire(P, ORG, {
        newAgent: { agentId: HR },
        title: "HR",
        reportsTo: CEO,
        budget: 10,
      });
      const desk = await service.desk(P, ORG, HR, {});
      await store.writeCalendarEvent(
        orgDir(),
        HR,
        "sweep",
        serializeCalendarEvent({
          prompt: "Sweep",
          enabled: true,
          startAt: new Date(T0).toISOString(),
          period: "1d",
        }),
      );
      await scheduler.tickOnce();
      started.length = 0;
      events.length = 0;

      costs.set(desk.sessionId, 9);
      await scheduler.tickOnce();
      expect(
        events.filter((e) => e.type === "org_budget").map((e) => (e as { state: string }).state),
      ).toEqual(["warned"]);
      await scheduler.tickOnce();
      expect(events.filter((e) => e.type === "org_budget")).toHaveLength(1);
      const finance = await service.finance(P, ORG);
      const hr = finance.employees.find((e) => e.agentId === HR)!;
      expect(hr).toMatchObject({ own: 9, cumulative: 9, budget: 10, warned: true, paused: false });
      expect(finance.employees.find((e) => e.agentId === CEO)!.cumulative).toBe(9);
      expect(finance.total).toBe(9);

      costs.set(desk.sessionId, 11);
      nowMs = T0 + DAY + 1;
      await scheduler.tickOnce();
      expect(
        events.filter((e) => e.type === "org_budget").map((e) => (e as { state: string }).state),
      ).toEqual(["warned", "paused"]);
      expect(started).toHaveLength(0);
      expect((await service.calendar(P, ORG)).events[0]).toMatchObject({
        lastOutcome: "paused",
        paused: true,
      });
      expect((await service.chart(P, ORG)).employees.find((e) => e.agentId === HR)!.state).toBe(
        "paused",
      );
      // The warning went to the day it fired on, the pause to the next day's file.
      const warned = await service.channelMessages(
        P,
        ORG,
        { userId: "alice" },
        DEFAULT_CHANNEL_ID,
        {
          date: zonedDate("Asia/Shanghai", T0),
        },
      );
      expect(
        warned.messages.some((m) => m.sender === "system" && m.text.startsWith("Budget warning")),
      ).toBe(true);
      const paused = await service.channelMessages(
        P,
        ORG,
        { userId: "alice" },
        DEFAULT_CHANNEL_ID,
        {},
      );
      expect(
        paused.messages.some((m) => m.sender === "system" && m.text.startsWith("Budget pause")),
      ).toBe(true);

      await service.patchEmployee(P, ORG, HR, { budget: 100 });
      expect(
        events.filter((e) => e.type === "org_budget").map((e) => (e as { state: string }).state),
      ).toEqual(["warned", "paused", "resumed"]);
      nowMs = T0 + 2 * DAY + 1;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      expect(parseOrgTriggerMessage(started[0]!.text)?.origin.budget).toBe(
        "11.00 / 100.00 USD (11%)",
      );
    });
  });

  describe("desks and caches", () => {
    it("renews a desk when the chart moves its workspace and keeps the old session counting", async () => {
      await createOrg();
      const first = await service.desk(P, ORG, CEO, {});
      expect(first.created).toBe(false);
      await fs.mkdir(path.join(orgDir(), "workspace", "hq"));
      await service.patchEmployee(P, ORG, CEO, { workspace: "hq" });
      const second = await service.desk(P, ORG, CEO, {});
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.workspace).toBe(path.join(orgDir(), "workspace", "hq"));
      const rows = cache.deskSessions(P, ORG);
      expect(rows.map((r) => [r.sessionId, r.current])).toEqual([
        [second.sessionId, true],
        [first.sessionId, false],
      ]);
      const renewed = await service.desk(P, ORG, CEO, { renew: true });
      expect(renewed.created).toBe(true);
      expect(cache.deskSessions(P, ORG)).toHaveLength(3);
      const list = await service.sessions(P, ORG);
      expect(list.desks.map((d) => d.sessionId)).toEqual([renewed.sessionId]);
    });

    it("rebuilds the session caches from the files after they are dropped", async () => {
      await createOrg();
      const desk = await service.desk(P, ORG, CEO, {});
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Cache me", owner: `agent:${CEO}` },
        { userId: "alice" },
      );
      const { sessionId } = await service.startTicket(P, ORG, t.ticketId, {});
      cache.deleteOrg(P, ORG);
      expect(cache.ownerOfSession(desk.sessionId)).toBeNull();
      await scheduler.tickOnce();
      expect(cache.ownerOfSession(desk.sessionId)).toMatchObject({ kind: "desk", agentId: CEO });
      expect(cache.ownerOfSession(sessionId)).toMatchObject({ kind: "ticket", agentId: CEO });
      expect(service.orgIdOfSession(sessionId)).toBe(ORG);
    });

    it("removing the organization keeps the Agents and sessions", async () => {
      await createOrg();
      const desk = await service.desk(P, ORG, CEO, {});
      await service.remove(P, ORG);
      expect(await service.list(P)).toEqual([]);
      expect(sessions.findById(desk.sessionId)).not.toBeNull();
      expect(cache.ownerOfSession(desk.sessionId)).toBeNull();
      await expect(fs.stat(orgDir())).rejects.toBeTruthy();
    });
  });
});
