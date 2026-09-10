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
import { DEFAULT_CHANNEL_ID, ticketPath } from "../src/organization/paths.js";
import { zonedDate } from "../src/organization/zoned.js";
import type { ErrorRecordArgs } from "../src/runtime/error-recorder.js";
import type { OrgDeps } from "../src/runtime/organization/deps.js";
import { OrganizationScheduler } from "../src/runtime/organization/scheduler.js";
import { OrganizationService } from "../src/runtime/organization/service.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { UtilityCompletion } from "../src/services/project-config-service.js";
import type { ServerEvent } from "../src/api/types.js";
import { makeTempRoot } from "./helpers.js";

const P = "p1";
const ORG = "acme";
const CEO = "acme_ceo";
const HR = "acme_hr";
const T0 = Date.parse("2026-09-01T01:00:00Z");
const DAY = 86_400_000;

/** The utility completion's three shapes, as the id proposals see them. */
const NO_MODEL: UtilityCompletion = {
  ok: false,
  cause: "no_model",
  error: "the Project names no default model",
};
const answered = (text: string): UtilityCompletion => ({ ok: true, text });
const failed = (error: string): UtilityCompletion => ({ ok: false, cause: "failed", error });

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
  let created: Array<{ projectId: string; agentId: string; workspace?: string; client: "org" }>;
  let agentsCreated: Array<{ agentId: string; plugins: readonly string[] }>;
  let briefs: Map<string, string>;
  let costs: Map<string, number>;
  let events: ServerEvent[];
  let errors: ErrorRecordArgs[];
  let companyMode: boolean;
  /**
   * The one-off utility completion behind semantic id proposals: the results it hands back in
   * order, one per call, and every prompt it was given. An exhausted queue answers
   * NO_MODEL — a Project with nothing configured is what "the model said nothing" means.
   */
  let completion: { answers: UtilityCompletion[]; prompts: string[] };
  let deps: OrgDeps;
  let scheduler: OrganizationScheduler;
  let service: OrganizationService;
  let seq: number;
  /** The Agents the fake gateway says exist; a test deletes one to make its desk unopenable. */
  let existingAgents: Set<string>;

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
    completion = { answers: [], prompts: [] };
    seq = 0;
    existingAgents = new Set<string>();
    deps = {
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
            client: args.client,
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
            // The real SessionService stores the caller's hint verbatim; a fake that wrote
            // "web" here would pass the marker's own test.
            client: args.client,
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
      completeOnce: async (_p, prompt) => {
        completion.prompts.push(prompt);
        return completion.answers.shift() ?? NO_MODEL;
      },
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
      // The purpose is empty: the UI writes the all-hands line itself, in the reader's language.
      value: {
        name: "All hands",
        purpose: "",
        createdBy: "system",
        everyone: true,
        archived: false,
      },
    });
    expect(agentsCreated).toEqual([
      { agentId: CEO, plugins: ["agent-company", "agent-development"] },
    ]);
    expect(briefs.get(CEO)).toContain(`<app_data_dir>/organizations/${ORG}/`);
    expect(created).toHaveLength(1);
    expect(created[0]!.workspace).toBe(path.join(dir, "workspace"));
    // The CEO is created with a budget, not unbounded: budgets accumulate along the
    // reporting line, so this one number caps the whole company from the first minute.
    expect((await service.chart(P, ORG)).employees).toMatchObject([{ agentId: CEO, budget: 100 }]);
    expect(started).toHaveLength(1);
    const parsed = parseOrgTriggerMessage(started[0]!.text);
    expect(parsed?.origin.kind).toBe("init");
    expect(parsed?.origin.org).toBe(ORG);
    expect(parsed?.origin.budget).toBe("0.00 / 100.00 USD (0%)");
    expect(parsed?.rest).toContain("Mission: Build a plugin marketplace");
    // The board decides: the init run proposes and stops before hiring anything.
    expect(parsed?.rest).toContain("END THIS RUN");
    expect(parsed?.rest).toContain("@user:alice");
    // The mission is English, so the organization works in English — its desk titles too.
    expect(sessions.findById(started[0]!.sessionId)?.title).toBe(`Name of ${CEO}'s desk`);
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

  it("writes the CEO budget creation asked for, zero included", async () => {
    await service.create(P, { orgId: ORG, mission: "Build it", ceoBudget: 25 }, "alice");
    expect((await service.chart(P, ORG)).employees[0]).toMatchObject({ agentId: CEO, budget: 25 });
    // Zero is a real budget (everything is already over it), not a request to be unbounded.
    await service.create(P, { orgId: "zero", mission: "Build it", ceoBudget: 0 }, "alice");
    expect((await service.chart(P, "zero")).employees[0]).toMatchObject({ budget: 0 });
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
    const joined = allHands.messages.find(
      (m) => m.sender === "system" && m.text.includes("agent:acme_hr joined as HR"),
    );
    // The sentence for the file and the CLI, the structure for a client that renders it in
    // the reader's language.
    expect(joined?.notice).toEqual({
      kind: "employee_joined",
      params: { agent: `agent:${HR}`, title: "HR", reportsTo: `agent:${CEO}` },
    });
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

  describe("employee workspaces", () => {
    it("creates a relative sub-directory as the employee is hired, and stores one spelling of it", async () => {
      await createOrg();
      const item = await service.hire(P, ORG, {
        newAgent: { agentId: HR },
        title: "HR",
        reportsTo: CEO,
        workspace: "./hr/",
      });
      const dir = path.join(orgDir(), "workspace", "hr");
      // The directory the CEO never created is there, and the chart holds the plain form.
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
      expect(item.workspace).toBe("hr");
      expect(item.resolvedWorkspace).toBe(dir);
      expect(item.invalid).toBeUndefined();
      // …and the desk opens in it, which is what `desk_unavailable` used to refuse.
      const desk = await service.desk(P, ORG, HR, {});
      expect(desk.workspace).toBe(dir);
    });

    it("refuses a spec that leaves the shared workspace, and an absolute path nobody created", async () => {
      await createOrg();
      await expect(
        service.hire(P, ORG, {
          newAgent: { agentId: HR },
          title: "HR",
          reportsTo: CEO,
          workspace: "../outside",
        }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_workspace" });
      await expect(
        service.hire(P, ORG, {
          newAgent: { agentId: HR },
          title: "HR",
          reportsTo: CEO,
          workspace: path.join(root, "nowhere"),
        }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_workspace" });
      // Nothing was written for either refusal.
      expect((await service.chart(P, ORG)).employees.map((e) => e.agentId)).toEqual([CEO]);
      await expect(fs.stat(path.join(orgDir(), "workspace", "outside"))).rejects.toBeTruthy();
    });

    it("creates the directory a hand-edited chart names, so the calendar still reaches that desk", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      // A hand edit, as a person or the CEO's file tools would leave it: a partition that
      // exists only in the file. The chart lists it as usable, and the desk creates it.
      await fs.writeFile(
        path.join(orgDir(), "org_chart.yaml"),
        [
          "employees:",
          `  - agent_id: ${CEO}`,
          "    title: CEO",
          "    reports_to: null",
          "    workspace: .",
          `  - agent_id: ${HR}`,
          "    title: HR",
          `    reports_to: ${CEO}`,
          "    workspace: people",
          "",
        ].join("\n"),
        "utf8",
      );
      const hr = (await service.chart(P, ORG)).employees.find((e) => e.agentId === HR)!;
      expect(hr.invalid).toBeUndefined();
      expect(hr.resolvedWorkspace).toBe(path.join(orgDir(), "workspace", "people"));
      const desk = await service.desk(P, ORG, HR, {});
      expect(desk.workspace).toBe(path.join(orgDir(), "workspace", "people"));
      expect((await fs.stat(path.join(orgDir(), "workspace", "people"))).isDirectory()).toBe(true);
    });

    it("reassigns a partition and creates the new one", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      const item = await service.patchEmployee(P, ORG, HR, { workspace: "./people" });
      expect(item.workspace).toBe("people");
      expect((await fs.stat(path.join(orgDir(), "workspace", "people"))).isDirectory()).toBe(true);
      await expect(
        service.patchEmployee(P, ORG, HR, { workspace: "../elsewhere" }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_workspace" });
    });
  });

  describe("the working language", () => {
    const ZH_MISSION = "做一个 DeepSeek Harness 插件市场，并靠首页置顶位盈利。";

    it("follows the mission: a Chinese mission gives a Chinese handbook, brief and init run", async () => {
      await service.create(P, { orgId: ORG, name: "插件市场", mission: ZH_MISSION }, "alice");
      const settings = (await service.detail(P, ORG, "alice")).settings;
      expect(settings.language).toBe("zh");
      expect(await fs.readFile(path.join(orgDir(), "org_config.toml"), "utf8")).toContain(
        'language = "zh"',
      );
      const handbook = await service.handbook(P, ORG);
      expect(handbook).toContain("## 工作语言");
      expect(handbook).toContain("## 使命");
      expect(handbook).toContain(ZH_MISSION);
      // Paths, commands and field names stay ASCII whatever the language is.
      expect(handbook).toContain("`org_chart.yaml`");
      expect(handbook).toContain("penguin org ticket start <id>");
      expect(briefs.get(CEO)).toContain("# 员工简介");
      expect(briefs.get(CEO)).toContain(`<app_data_dir>/organizations/${ORG}/`);
      const parsed = parseOrgTriggerMessage(started[0]!.text);
      expect(parsed?.rest).toContain(`使命：${ZH_MISSION}`);
      expect(parsed?.rest).toContain("penguin org ticket start <id>");
      expect(sessions.findById(started[0]!.sessionId)?.title).toBe(`Name of ${CEO} 的工位`);
      // Hires inherit it: the brief is written in the organization's language, not the request's.
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "人事", reportsTo: CEO });
      expect(briefs.get(HR)).toContain("# 员工简介");
    });

    it("takes the request's language over the mission's, and PATCH changes it", async () => {
      await service.create(P, { orgId: ORG, mission: ZH_MISSION, language: "en" }, "alice");
      expect(await service.handbook(P, ORG)).toContain("## Working language");
      const settings = await service.patch(P, ORG, { language: "zh" });
      expect(settings.language).toBe("zh");
      expect(await fs.readFile(path.join(orgDir(), "org_config.toml"), "utf8")).toContain(
        'language = "zh"',
      );
      // The handbook is an intent file: a language change never rewrites what the CEO owns.
      expect(await service.handbook(P, ORG)).toContain("## Working language");
    });

    it("says English when nothing was ever written, so an old organization still reports one", async () => {
      await createOrg();
      const raw = await fs.readFile(path.join(orgDir(), "org_config.toml"), "utf8");
      await fs.writeFile(
        path.join(orgDir(), "org_config.toml"),
        raw.replace('language = "en"\n', ""),
        "utf8",
      );
      expect((await service.detail(P, ORG, "alice")).settings.language).toBe("en");
    });
  });

  describe("semantic id proposals", () => {
    /** `co_org_<yyyymmdd>` / `ch_channel_<yyyymmdd>` for today, which is what a placeholder reads as. */
    function placeholderFor(kind: "org" | "channel"): string {
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      return kind === "org" ? `co_org_${stamp}` : `ch_channel_${stamp}`;
    }

    it("takes the model's answer, names the ids already taken, and never returns one of them", async () => {
      completion.answers = [answered("`research_paper_lab`\n")];
      // The model answers the semantic core; the server puts the kind's prefix on it.
      expect(await service.suggestId(P, { name: "科研论文公司", kind: "org" })).toEqual({
        id: "co_research_paper_lab",
        source: "model",
      });
      expect(completion.prompts[0]).toContain("科研论文公司");
      completion.answers = [answered("site")];
      expect(
        await service.suggestId(P, { name: "站点", kind: "channel", taken: ["ch_site"] }),
      ).toEqual({ id: "ch_site_2", source: "model" });
      expect(completion.prompts[1]).toContain("Those answers are taken, prefix included: ch_site.");
      // One ask each: a usable answer is never second-guessed.
      expect(completion.prompts).toHaveLength(2);
      expect(errors).toEqual([]);
    });

    it("asks a second time, with the format spelled out, when the first answer is not an id", async () => {
      completion.answers = [answered("我建议叫「科研实验室」"), answered("research_lab")];
      expect(await service.suggestId(P, { name: "科研公司", kind: "org" })).toEqual({
        id: "co_research_lab",
        source: "model",
      });
      expect(completion.prompts).toHaveLength(2);
      expect(completion.prompts[0]).not.toContain("Answer with the identifier only");
      expect(completion.prompts[1]).toContain("Answer with the identifier only");
      expect(errors).toEqual([]);
    });

    it("falls back to the ASCII slug when neither answer is usable, and records why", async () => {
      completion.answers = [answered("我建议叫「科研实验室」"), answered("还是叫科研实验室吧")];
      expect(await service.suggestId(P, { name: "Plugin Marketplace", kind: "org" })).toEqual({
        id: "co_plugin_marketplace",
        source: "fallback",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ source: "organization", code: "id_suggest_failed" });
      expect(String((errors[0]?.err as Error).message)).toContain("还是叫科研实验室吧");
    });

    it("does not repeat a request that failed outright, and records the provider's reason", async () => {
      completion.answers = [failed("401 invalid api key")];
      expect(await service.suggestId(P, { name: "Plugin Marketplace", kind: "org" })).toEqual({
        id: "co_plugin_marketplace",
        source: "fallback",
      });
      expect(completion.prompts).toHaveLength(1);
      expect(String((errors[0]?.err as Error).message)).toContain("401 invalid api key");
    });

    it("answers a dated placeholder, never a failure, when neither the model nor the name can name it", async () => {
      // The model answered twice and neither answer was an id.
      completion.answers = [answered("科研实验室"), answered("实验室")];
      expect(await service.suggestId(P, { name: "科研公司", kind: "org" })).toEqual({
        id: placeholderFor("org"),
        source: "placeholder",
        reason: "unusable_answer",
      });
      // Nothing to ask: the Project names no default model.
      completion.answers = [];
      expect(await service.suggestId(P, { name: "市场推广", kind: "channel" })).toEqual({
        id: placeholderFor("channel"),
        source: "placeholder",
        reason: "no_default_model",
      });
      // The request failed on the wire.
      completion.answers = [failed("connect ETIMEDOUT")];
      expect(await service.suggestId(P, { name: "科研公司", kind: "org" })).toEqual({
        id: placeholderFor("org"),
        source: "placeholder",
        reason: "model_failed",
      });
      // A placeholder still avoids the ids already in use.
      completion.answers = [];
      expect(
        await service.suggestId(P, {
          name: "科研公司",
          kind: "org",
          taken: [placeholderFor("org")],
        }),
      ).toMatchObject({ id: `${placeholderFor("org")}_2`, source: "placeholder" });
    });

    it("says no_ascii when there is no model to ask at all", async () => {
      const noModelService = new OrganizationService(
        { ...deps, completeOnce: undefined },
        scheduler,
      );
      expect(await noModelService.suggestId(P, { name: "科研公司", kind: "org" })).toEqual({
        id: placeholderFor("org"),
        source: "placeholder",
        reason: "no_ascii",
      });
    });
  });

  describe("company mode's own sessions", () => {
    it('stamps every desk and ticket session client: "org", and a reconcile pass marks one that is not', async () => {
      await createOrg();
      const ceoDesk = (await service.desk(P, ORG, CEO, {})).sessionId;
      expect(created.at(-1)?.client).toBe("org");
      expect(sessions.findById(ceoDesk)?.client).toBe("org");
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Ship it", owner: `agent:${CEO}` },
        { userId: "alice" },
      );
      const { sessionId: work } = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        {},
        { userId: "alice" },
      );
      expect(sessions.findById(work)?.client).toBe("org");

      // What an organization that predates the marker looks like: its files still name the
      // sessions, so the next reconcile pass stamps them.
      db.prepare("UPDATE sessions SET client = NULL WHERE session_id IN (?, ?)").run(ceoDesk, work);
      expect(sessions.findById(ceoDesk)?.client).toBeNull();
      await scheduler.reconcile(P, ORG);
      expect(sessions.findById(ceoDesk)?.client).toBe("org");
      expect(sessions.findById(work)?.client).toBe("org");

      // The stamp is the row's own, so an organization whose directory was removed by hand
      // leaves it in place — which is the whole point: nothing else is left to say whose the
      // sessions were.
      await fs.rm(orgDir(), { recursive: true, force: true });
      await scheduler.tickOnce();
      expect(await service.list(P)).toEqual([]);
      expect(sessions.findById(ceoDesk)?.client).toBe("org");
      expect(sessions.findById(work)?.client).toBe("org");
    });
  });

  describe("who starts a ticket session", () => {
    it("an employee starts one only on the ticket it owns; a person on any", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      const ceoDesk = (await service.desk(P, ORG, CEO, {})).sessionId;
      const hrDesk = (await service.desk(P, ORG, HR, {})).sessionId;
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Ship it", owner: `agent:${HR}` },
        { userId: "alice" },
      );

      // The CEO files and assigns; the owner's desk is what turns that into work.
      await expect(
        service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice", sessionId: ceoDesk }),
      ).rejects.toMatchObject({ status: 403, code: "not_ticket_owner" });

      const own = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        {},
        { userId: "alice", sessionId: hrDesk },
      );
      expect(sessions.findById(own.sessionId)?.agentId).toBe(HR);

      // The owner may enlist a colleague on its OWN ticket — how a request for help is answered.
      const helper = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        { agentId: CEO },
        { userId: "alice", sessionId: hrDesk },
      );
      expect(sessions.findById(helper.sessionId)?.agentId).toBe(CEO);

      // A person is not an employee of anything: the board may start any ticket.
      const byPerson = await service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice" });
      expect(sessions.findById(byPerson.sessionId)?.agentId).toBe(HR);
    });

    it("an unowned ticket needs an owner before an employee may start it", async () => {
      await createOrg();
      const ceoDesk = (await service.desk(P, ORG, CEO, {})).sessionId;
      const t = await service.createTicket(P, ORG, { title: "Unowned" }, { userId: "alice" });
      await expect(
        service.startTicket(
          P,
          ORG,
          t.ticketId,
          { agentId: CEO },
          { userId: "alice", sessionId: ceoDesk },
        ),
      ).rejects.toMatchObject({ status: 403, code: "not_ticket_owner" });
      const byPerson = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        { agentId: CEO },
        { userId: "alice" },
      );
      expect(sessions.findById(byPerson.sessionId)?.agentId).toBe(CEO);
    });
  });

  describe("the overview inbox", () => {
    it("lists what names you, what is blocked and what closed this period", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      const alice = { userId: "alice" };

      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "nothing to see here",
      });
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "@user:alice the plan is ready",
      });
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "@all standup at ten",
      });

      const blocked = await service.createTicket(
        P,
        ORG,
        { title: "Blocked one", slug: "b-blocked", owner: `agent:${HR}` },
        alice,
      );
      await service.blockTicket(
        P,
        ORG,
        blocked.ticketId,
        "waiting on the vendor",
        undefined,
        alice,
      );
      const closed = await service.createTicket(
        P,
        ORG,
        { title: "Closed one", slug: "a-closed", owner: `agent:${HR}` },
        alice,
      );
      await service.moveTicket(P, ORG, closed.ticketId, "done", undefined, alice);
      const open = await service.createTicket(
        P,
        ORG,
        { title: "Still open", slug: "c-open", owner: `agent:${HR}` },
        alice,
      );

      const inbox = (await service.detail(P, ORG, "alice")).inbox!;
      // Newest first, and only the lines that name this person (the ticket changes the
      // scheduler writes name them too, so the assertion is over what a colleague wrote).
      expect(inbox.mentions.filter((m) => m.sender !== "system").map((m) => m.text)).toEqual([
        "@all standup at ten",
        "@user:alice the plan is ready",
      ]);
      expect(inbox.mentions.map((m) => m.text)).not.toContain("nothing to see here");
      for (const m of inbox.mentions) {
        expect(m.mentions.includes("user:alice") || m.mentions.includes("all")).toBe(true);
      }
      expect(inbox.blockedTickets.map((t) => t.ticketId)).toEqual([blocked.ticketId]);
      expect(inbox.blockedTickets[0]!.blocked).toBe("waiting on the vendor");
      expect(inbox.doneTickets.map((t) => t.ticketId)).toEqual([closed.ticketId]);
      expect(inbox.doneTickets[0]!.closedAt).toBe(new Date(nowMs).toISOString());
      expect(inbox.doneTickets.map((t) => t.ticketId)).not.toContain(open.ticketId);
    });

    it("a ticket closed in an earlier period drops out; one closed by hand stays with no time", async () => {
      await createOrg();
      const alice = { userId: "alice" };
      const early = await service.createTicket(
        P,
        ORG,
        { title: "Closed in September", slug: "september" },
        alice,
      );
      await service.moveTicket(P, ORG, early.ticketId, "done", undefined, alice);
      // A ticket whose file was moved by hand carries no closing line at all.
      const byHand = await service.createTicket(
        P,
        ORG,
        { title: "Moved by hand", slug: "by-hand" },
        alice,
      );
      await service.moveTicket(P, ORG, byHand.ticketId, "done", undefined, alice);
      const file = ticketPath(orgDir(), byHand.ticketId, "done");
      const raw = await fs.readFile(file, "utf8");
      await fs.writeFile(
        file,
        raw
          .split("\n")
          .filter((line) => !line.includes("→ done"))
          .join("\n"),
        "utf8",
      );

      nowMs = T0 + 40 * DAY;
      const inbox = (await service.detail(P, ORG, "alice")).inbox!;
      const ids = inbox.doneTickets.map((t) => t.ticketId);
      expect(ids).not.toContain(early.ticketId);
      expect(ids).toContain(byHand.ticketId);
      expect(
        inbox.doneTickets.find((t) => t.ticketId === byHand.ticketId)?.closedAt,
      ).toBeUndefined();
    });
  });

  it("announces a departure with the manager the reports move to", async () => {
    await createOrg();
    await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
    await service.leave(P, ORG, HR);
    const allHands = await service.channelMessages(
      P,
      ORG,
      { userId: "alice" },
      DEFAULT_CHANNEL_ID,
      {},
    );
    const left = allHands.messages.find((m) => m.text.includes("left the organization"));
    expect(left?.text).toBe(`agent:${HR} left the organization; reports now go to agent:${CEO}.`);
    expect(left?.notice).toEqual({
      kind: "employee_left",
      params: { agent: `agent:${HR}`, reportsTo: `agent:${CEO}` },
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

    it("answers a write with the rota it collides with, and writes it anyway", async () => {
      await createOrg();
      await hireHr();
      const fields = {
        prompt: "Sweep",
        enabled: true,
        startAt: "2026-09-02T10:00:00+08:00",
        period: "1d",
      };
      const first = await service.upsertCalendar(P, ORG, HR, "hr-audit", fields, { create: true });
      expect(first.warnings).toBeUndefined();
      const clash = await service.upsertCalendar(P, ORG, CEO, "board-sweep", fields, {
        create: true,
      });
      expect(clash.warnings).toEqual([
        `\`${HR}/hr-audit\` also fires at 10:00; give every employee its own minute.`,
      ]);
      // Advisory only: the event is stored exactly as asked.
      expect((await service.calendar(P, ORG)).events.map((e) => e.name).sort()).toEqual([
        "board-sweep",
        "hr-audit",
      ]);
      const second = await service.upsertCalendar(
        P,
        ORG,
        HR,
        "extra-sweep",
        { ...fields, startAt: new Date(nowMs).toISOString() },
        { create: true },
      );
      expect(second.warnings).toEqual([
        `\`${HR}\` already has a recurring event \`hr-audit\` with period 1d; one sweep per employee.`,
        "A recurring event started at 'now' shares its minute with every other event started the same way; pick the role's hour.",
      ]);
      // Staggering it clears the advice on update.
      const updated = await service.upsertCalendar(
        P,
        ORG,
        CEO,
        "board-sweep",
        { ...fields, startAt: "2026-09-02T14:00:00+08:00" },
        { create: false },
      );
      expect(updated.warnings).toBeUndefined();
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

    it("creates in proposed with the initiator, queues the assignment, and opens ticket sessions that contribute", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Launch the site", goal: "Ship it", owner: `agent:${HR}`, priority: "P1" },
        { userId: "alice" },
      );
      expect(t.ticketId).toMatch(/^2026-09-01-launch-the-site$/);
      expect(t.status).toBe("proposed");
      expect(t.initiator).toBe("user:alice");
      // A person who files a ticket is not @-mentioned when it closes; it lists itself to be.
      expect(t.notify).toEqual([]);
      await expect(
        fs.stat(path.join(orgDir(), "tickets", "2026-09", "proposed", `${t.ticketId}.md`)),
      ).resolves.toBeTruthy();
      // Assignment at creation opens no desk and starts no run: it waits for the owner's sweep.
      expect(started).toHaveLength(0);
      await scheduler.tickOnce();
      expect(started).toHaveLength(0);

      const { sessionId } = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        { message: "Start with the scaffold" },
        { userId: "alice" },
      );
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
      // Where it stands, and the rule that makes its output findable by a colleague.
      expect(work!.text).toContain(
        `Workspace: ${path.join(orgDir(), "workspace")} — the organization is at \`<app_data_dir>/organizations/${ORG}/\`.`,
      );
      expect(work!.text).toContain(
        "Name every input you rely on and every deliverable you produce by its full path",
      );

      // A second session for the same ticket, and progress written from inside it.
      const second = await service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice" });
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

    it("delivers queued changes in the next sweep, keeps them while paused, and empties the queue", async () => {
      await store.writeCalendarEvent(
        orgDir(),
        HR,
        "sweep",
        serializeCalendarEvent({
          prompt: "Sweep the board",
          enabled: true,
          startAt: new Date(T0).toISOString(),
          period: "1d",
        }),
      );
      await scheduler.tickOnce(); // registers the event and consumes the slot standing at T0
      started.length = 0;

      const t = await service.createTicket(
        P,
        ORG,
        { title: "Launch the site", owner: `agent:${HR}`, notify: [`agent:${HR}`] },
        { userId: "alice" },
      );
      await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, { userId: "alice" });
      await service.moveTicket(P, ORG, t.ticketId, "done", undefined, { userId: "alice" });
      // An owner assigned and a ticket closed: two changes, no run at any desk.
      expect(started).toHaveLength(0);

      // A paused organization consumes the slot and keeps the queue for the sweep that fires.
      await service.patch(P, ORG, { status: "paused" });
      nowMs = T0 + DAY + 1000;
      await scheduler.tickOnce();
      expect(started).toHaveLength(0);
      expect((await service.calendar(P, ORG)).events[0]!.lastOutcome).toBe("paused");
      await service.patch(P, ORG, { status: "active" });

      nowMs = T0 + 2 * DAY + 1000;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      const parsed = parseOrgTriggerMessage(started[0]!.text);
      expect(parsed?.origin).toMatchObject({ kind: "event", event: "sweep" });
      expect(parsed?.rest).toBe(
        [
          "Sweep the board",
          "",
          "## Since your last sweep",
          `- ${t.ticketId} (Launch the site): assigned to you`,
          `- ${t.ticketId} (Launch the site): done`,
          "",
          'Decide on each: start a ticket session (`penguin org ticket start <id> -m "…"`), verify and unblock, or leave it — do not do the work at your desk.',
        ].join("\n"),
      );

      // Delivered once: the next sweep carries the event's own prompt and nothing else.
      started.length = 0;
      nowMs = T0 + 3 * DAY + 1000;
      await scheduler.tickOnce();
      expect(parseOrgTriggerMessage(started[0]!.text)?.rest).toBe("Sweep the board");
    });

    it("puts the queued changes back when the sweep cannot start", async () => {
      await store.writeCalendarEvent(
        store.dir(P, ORG),
        HR,
        "sweep",
        serializeCalendarEvent({
          prompt: "Sweep the board",
          enabled: true,
          startAt: new Date(T0).toISOString(),
          period: "1d",
        }),
      );
      await scheduler.tickOnce();
      started.length = 0;
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Write the FAQ", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      expect(started).toHaveLength(0);

      // The Agent vanishes, so the desk cannot be opened: the slot fails and the change is kept.
      existingAgents.delete(HR);
      nowMs = T0 + DAY + 1000;
      await scheduler.tickOnce();
      expect(started).toHaveLength(0);
      expect((await service.calendar(P, ORG)).events[0]!.lastOutcome).toBe("error");

      existingAgents.add(HR);
      nowMs = T0 + 2 * DAY + 1000;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      expect(parseOrgTriggerMessage(started[0]!.text)?.rest).toContain(
        `- ${t.ticketId} (Write the FAQ): assigned to you`,
      );
    });

    it("drops an employee's undelivered changes when it leaves", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Write docs", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      await service.leave(P, ORG, HR);
      expect(cache.takeDeskNotices(P, ORG, HR)).toEqual([]);
      expect(t.owner).toBe(`agent:${HR}`);
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
      // Notify = CEO (agent) and the initiator alice (user): the change is queued for the
      // CEO's next sweep and written as a system line for alice. Neither is a run.
      expect(started).toHaveLength(0);
      expect(cache.takeDeskNotices(P, ORG, CEO).map((n) => [n.ticketId, n.change])).toEqual([
        [t.ticketId, "done"],
      ]);
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
      // The line lands for the board to read; nobody is @-mentioned, because the only user
      // involved is the initiator and it did not ask to be told.
      expect(line?.mentions).toEqual([]);
      expect(line?.text).toBe(`Ticket ${t.ticketId} (Write docs) is now done`);
      expect(line?.notice).toEqual({
        kind: "ticket_done",
        params: { ticket: t.ticketId, title: "Write docs" },
      });
      expect(line?.refs?.ticket).toBe(t.ticketId);
      expect(events.some((e) => e.type === "org_ticket" && e.change === "status:done")).toBe(true);
      const board = await service.tickets(P, ORG);
      expect(board.columns.done.map((x) => x.ticketId)).toEqual([t.ticketId]);
    });

    it("books the writing session onto the ticket, so a desk that did the work pays for it", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Fix the footer", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      const desk = await service.desk(P, ORG, HR, {});
      const fromDesk = { userId: "alice", sessionId: desk.sessionId };

      // A person's write books nothing: there is no session behind it.
      await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, { userId: "alice" });
      expect((await service.ticket(P, ORG, t.ticketId)).sessions).toEqual([]);
      // Management from a desk books nothing either: accepting, blocking and unblocking are
      // decisions about the ticket, not work on it.
      await service.moveTicket(P, ORG, t.ticketId, "proposed", undefined, fromDesk);
      await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, fromDesk);
      await service.blockTicket(P, ORG, t.ticketId, "waiting for copy", undefined, fromDesk);
      await service.unblockTicket(P, ORG, t.ticketId, fromDesk);
      expect((await service.ticket(P, ORG, t.ticketId)).sessions).toEqual([]);

      // Handing the work in claims it: the desk is booked from the move into review on.
      const moved = await service.moveTicket(P, ORG, t.ticketId, "review", undefined, fromDesk);
      expect(moved.sessions).toEqual([desk.sessionId]);
      // Every other work write from the same session is the same contribution, booked once.
      await service.progressTicket(P, ORG, t.ticketId, "footer replaced", fromDesk);
      const after = await service.updateTicket(P, ORG, t.ticketId, { priority: "P1" }, fromDesk);
      expect(after.sessions).toEqual([desk.sessionId]);
      expect(cache.ticketSessions(P, ORG).map((r) => [r.ticketId, r.sessionId])).toEqual([
        [t.ticketId, desk.sessionId],
      ]);
      // The desk's cost is now the ticket's cost too — that is what the booking is for.
      costs.set(desk.sessionId, 4);
      expect((await service.ticket(P, ORG, t.ticketId)).cost).toBe(4);
      const finance = await service.finance(P, ORG);
      expect(finance.tickets.find((x) => x.ticketId === t.ticketId)?.cost).toBe(4);
    });

    it("files a ticket in another principal's name, and refuses one nobody holds", async () => {
      const byEmployee = await service.createTicket(
        P,
        ORG,
        { title: "Audit the calendar", initiator: HR },
        { userId: "alice" },
      );
      // A bare Agent id is the employee's principal; an employee initiator is notified at its desk.
      expect(byEmployee.initiator).toBe(`agent:${HR}`);
      expect(byEmployee.notify).toEqual([`agent:${HR}`]);
      expect(byEmployee.progress[0]).toMatchObject({
        by: `agent:${HR}`,
        text: "created the ticket",
      });
      const prefixed = await service.createTicket(
        P,
        ORG,
        { title: "Audit again", initiator: `agent:${CEO}` },
        { userId: "alice" },
      );
      expect(prefixed.initiator).toBe(`agent:${CEO}`);
      const byUser = await service.createTicket(
        P,
        ORG,
        { title: "Board request", initiator: "user:alice" },
        { userId: "alice" },
      );
      expect(byUser.initiator).toBe("user:alice");
      expect(byUser.notify).toEqual([]);
      for (const initiator of ["ghost", `agent:ghost`, "user:mallory", "all"]) {
        await expect(
          service.createTicket(P, ORG, { title: "Nope", initiator }, { userId: "alice" }),
        ).rejects.toMatchObject({ status: 400 });
      }
    });

    it("mentions on completion only the users Notify names", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Tell me", notify: ["user:alice"] },
        { userId: "alice" },
      );
      await service.moveTicket(P, ORG, t.ticketId, "done", undefined, { userId: "alice" });
      const allHands = await service.channelMessages(
        P,
        ORG,
        { userId: "alice" },
        DEFAULT_CHANNEL_ID,
        {},
      );
      const lines = allHands.messages.filter(
        (m) => m.sender === "system" && m.text.includes(t.ticketId),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]!.mentions).toEqual(["user:alice"]);
      expect(lines[0]!.text).toBe(`Ticket ${t.ticketId} (Tell me) is now done: @user:alice`);
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
      // The assignment is already queued for HR; clear it so the later lines stand alone.
      expect(cache.takeDeskNotices(P, ORG, HR).map((n) => n.change)).toEqual(["assigned"]);
      await service.blockTicket(P, ORG, t.ticketId, "Waiting for the domain", blocker.ticketId, {
        userId: "alice",
      });
      const detail = await service.ticket(P, ORG, t.ticketId);
      expect(detail.blocked).toBe("Waiting for the domain");
      expect(detail.blockedBy).toBe(blocker.ticketId);
      // HR's manager is the CEO; the block waits in its queue rather than interrupting it.
      expect(started).toHaveLength(0);
      expect(cache.takeDeskNotices(P, ORG, CEO).map((n) => [n.ticketId, n.change])).toEqual([
        [t.ticketId, "blocked"],
      ]);
      await service.moveTicket(P, ORG, blocker.ticketId, "done", undefined, { userId: "alice" });
      expect(started).toHaveLength(0);
      // The owner of the waiting ticket learns the blocker closed, in its own next sweep.
      expect(cache.takeDeskNotices(P, ORG, HR).map((n) => [n.ticketId, n.change])).toEqual([
        [t.ticketId, "blocker_closed"],
      ]);
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
      const lines = (await service.channelMessages(P, ORG, alice, "site", {})).messages;
      expect(lines.map((m) => m.text)).toEqual([
        `agent:${CEO} created the channel.`,
        "user:alice joined the channel.",
        `agent:${CEO} invited agent:${HR} to the channel.`,
      ]);
      expect(lines.map((m) => m.notice)).toEqual([
        { kind: "channel_created", params: { by: `agent:${CEO}` } },
        { kind: "channel_joined", params: { principal: "user:alice" } },
        { kind: "channel_invited", params: { by: `agent:${CEO}`, principal: `agent:${HR}` } },
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
      expect(warned.messages.find((m) => m.text.startsWith("Budget warning"))?.notice).toEqual({
        kind: "budget_warned",
        params: {
          agent: `agent:${HR}`,
          period: "2026-09",
          percent: "90",
          cost: "9.00",
          budget: "10.00",
        },
      });
      const paused = await service.channelMessages(
        P,
        ORG,
        { userId: "alice" },
        DEFAULT_CHANNEL_ID,
        {},
      );
      expect(paused.messages.find((m) => m.text.startsWith("Budget pause"))?.notice?.kind).toBe(
        "budget_paused",
      );

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
      const { sessionId } = await service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice" });
      cache.deleteOrg(P, ORG);
      expect(cache.ownerOfSession(desk.sessionId)).toBeNull();
      await scheduler.tickOnce();
      expect(cache.ownerOfSession(desk.sessionId)).toMatchObject({ kind: "desk", agentId: CEO });
      expect(cache.ownerOfSession(sessionId)).toMatchObject({ kind: "ticket", agentId: CEO });
      expect(service.orgIdOfSession(sessionId)).toBe(ORG);
    });

    it("maps a Project's organization sessions in one lookup, desks and ticket sessions alike", async () => {
      await createOrg();
      const desk = await service.desk(P, ORG, CEO, {});
      const ticket = await service.createTicket(
        P,
        ORG,
        { title: "Map me", owner: `agent:${CEO}` },
        { userId: "alice" },
      );
      const { sessionId: work } = await service.startTicket(
        P,
        ORG,
        ticket.ticketId,
        {},
        { userId: "alice" },
      );
      // What the session list stamps as SessionInfo.orgId: one map for the whole Project
      // instead of a query per row.
      const ids = cache.orgIdsOfProject(P);
      expect(ids.get(desk.sessionId)).toBe(ORG);
      expect(ids.get(work)).toBe(ORG);
      expect(ids.has("session-2026-09-01-00-00-00-0000ffff")).toBe(false);
      expect(cache.orgIdsOfProject("other_project").size).toBe(0);
    });

    it("pausing keeps every desk session open, and nothing removes an organization", async () => {
      await createOrg();
      const desk = await service.desk(P, ORG, CEO, {});
      // Pause is the whole lifecycle: the organization stays listed and its desk stays open.
      await service.patch(P, ORG, { status: "paused" });
      expect((await service.list(P)).map((o) => o.status)).toEqual(["paused"]);
      expect((await service.desk(P, ORG, CEO, {})).sessionId).toBe(desk.sessionId);
      expect(await service.detail(P, ORG, "alice")).toMatchObject({
        settings: { status: "paused" },
      });
      expect(await fs.stat(orgDir())).toBeTruthy();

      // The only way one goes away is by hand, and it takes neither the Agent nor the session.
      await fs.rm(orgDir(), { recursive: true, force: true });
      await scheduler.tickOnce();
      expect(await service.list(P)).toEqual([]);
      expect(existingAgents.has(CEO)).toBe(true);
      expect(sessions.findById(desk.sessionId)).not.toBeNull();
    });
  });
});
