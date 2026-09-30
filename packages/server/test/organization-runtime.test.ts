/**
 * Organization runtime semantics with doubles and a controlled clock — no real LLM, no
 * core Session: creation writes the files and opens the CEO's desk with an init run; a hire
 * opens the newcomer's desk and the reconcile pass opens the desks nothing else did (a
 * hand-added employee, a session deleted from under the ledger); a
 * calendar event registered after its time is not backfilled and fires on its next slot to
 * the employee's desk (queued when busy, held when the organization or the employee is
 * paused, held silently when the master switch is off); ticket changes are noticed once;
 * channel mentions reach desks and the chain stops at the limit; budgets warn, pause and
 * resume (a zero budget being over before anything is spent); a ticket session the runner
 * refuses leaves the ticket as it was; and every pass brings an employee whose company
 * plugins fell behind the library back up to it.
 */
import fs from "node:fs/promises";
import { wire } from "@prismshadow/penguin-core/kernel";
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
import { DEFAULT_EMPLOYEE_PLUGINS } from "../src/runtime/organization/deps.js";
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
/** The version the fake plugin library offers; an employee set behind it is what a pass fixes. */
const LIBRARY_VERSION = "2026.09.14.1";

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
  /** Set by a test to make every task start throw — a runner that refuses the work. */
  let startFails: boolean;
  let started: Started[];
  let created: Array<{
    projectId: string;
    agentId: string;
    workspace?: string;
    modelId?: string;
    provider?: string;
    client: "org";
  }>;
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
  /**
   * The plugin library and the Agents' installed copies as the fake gateway answers them:
   * `library` per plugin name, `installed` keyed `<agentId>:<plugin>` (a hire records the
   * library's version, so an employee is current until a test sets its entry back),
   * `updated` every update performed, and `failUpdates` the pairs whose update throws.
   */
  let plugins: {
    library: Map<string, string>;
    installed: Map<string, string>;
    updated: Array<{ agentId: string; plugin: string }>;
    failUpdates: Set<string>;
  };

  beforeEach(async () => {
    root = await makeTempRoot();
    await saveProjectConfig(root, P, {
      default_model: { provider: "custom", model_id: "m-bench" },
      models: [{ provider: "custom", model_id: "m-bench" }],
    });
    db = openDatabase(":memory:");
    wire(UsersRepo, { db }).insert({
      userId: "alice",
      passwordHash: "x",
      isAdmin: false,
      passwordIsInitial: false,
      displayName: null,
      avatar: null,
      createdAt: "2026-08-01T00:00:00Z",
    });
    const projects = wire(ProjectsRepo, { db });
    projects.insert({ projectId: P, ownerUserId: "alice", createdAt: "2026-08-01T00:00:00Z" });
    sessions = wire(SessionsRepo, { db });
    cache = wire(OrgCacheRepo, { db });
    store = new OrgStore(root);
    nowMs = T0;
    busy = new Set();
    startFails = false;
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
    plugins = {
      library: new Map(DEFAULT_EMPLOYEE_PLUGINS.map((name) => [name, LIBRARY_VERSION])),
      installed: new Map(),
      updated: [],
      failUpdates: new Set(),
    };
    deps = {
      root,
      store,
      cache,
      projects,
      members: wire(MembersRepo, { db }),
      sessions,
      runner: {
        statusOf: (id) => (busy.has(id) ? "running" : "idle"),
        startTask: async (sessionId, input, opts) => {
          if (startFails) throw new Error("the runner refused the task");
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
            // Recorded as passed: an absent pair is what makes the real SessionService
            // resolve the Project's default model at this moment, so a test can tell "no
            // model asked for" from "the default asked for by name".
            ...(args.modelId !== undefined ? { modelId: args.modelId } : {}),
            ...(args.provider !== undefined ? { provider: args.provider } : {}),
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
        create: async (_p, agentId, _name, _description, seeds) => {
          existingAgents.add(agentId);
          agentsCreated.push({ agentId, plugins: seeds });
          // Creation installs the library's current content, so a fresh hire is never behind.
          for (const name of seeds) {
            const version = plugins.library.get(name);
            if (version !== undefined) plugins.installed.set(`${agentId}:${name}`, version);
          }
        },
        displayName: async (_p, agentId) => `Name of ${agentId}`,
        writeAgentsMd: async (_p, agentId, content) => {
          briefs.set(agentId, content);
        },
        pluginVersion: async (_p, agentId, plugin) => ({
          installed: plugins.installed.get(`${agentId}:${plugin}`) ?? null,
          library: plugins.library.get(plugin) ?? null,
        }),
        updatePlugin: async (_p, agentId, plugin) => {
          if (plugins.failUpdates.has(`${agentId}:${plugin}`)) {
            throw new Error(`plugin ${plugin} could not be written`);
          }
          const version = plugins.library.get(plugin);
          if (version === undefined) throw new Error(`Plugin is not in the library: ${plugin}`);
          plugins.installed.set(`${agentId}:${plugin}`, version);
          plugins.updated.push({ agentId, plugin });
        },
      },
      projectConfig: wire(ProjectConfigService, { paths: { root } }),
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
      messagingChannel: () => null,
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
    // The shared root is nobody's desk: the CEO gets `ceo/`, made by the init dispatch.
    expect(created[0]!.workspace).toBe(path.join(dir, "workspace", "ceo"));
    expect((await fs.stat(path.join(dir, "workspace", "ceo"))).isDirectory()).toBe(true);
    expect((await service.chart(P, ORG)).employees[0]!.workspace).toBe("ceo");
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
    // The plan names roles and budgets, never a model per role: every hire runs on the
    // organization's model, or the Project's default when the organization names none.
    expect(parsed?.rest).toContain(
      "every one on the organization's model, or the Project's default model when the organization names none",
    );
    expect(parsed?.rest).not.toContain("budgets and model");
    // Whatever touches the machine or the outside is the board's for every employee.
    expect(parsed?.rest).toContain("What you may not decide alone");
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
    expect(created[0]!.workspace).toBe(path.join(shared, "ceo"));
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
    // The organization's model reaches a hire that names none without being pinned on its
    // entry: the chart carries no model, and the desk opens on the organization's pair.
    expect(
      (await service.chart(P, ORG)).employees.find((e) => e.agentId === HR),
    ).not.toHaveProperty("model");
    expect(created.at(-1)).toMatchObject({ agentId: HR, provider: "custom", modelId: "m-bench" });
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

  it("hires without a model by default: the entry carries none and the hire's sessions open without a model pair, so the Project default is resolved as each session opens", async () => {
    await createOrg();
    await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
    const entry = (await service.chart(P, ORG)).employees.find((e) => e.agentId === HR);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("model");
    // The hire opened the newcomer's desk with no (provider, modelId) pair: that absence is
    // what makes the real SessionService fall back to the Project's default model at this
    // moment, rather than to a value baked into the chart at creation.
    const desk = created.at(-1)!;
    expect(desk.agentId).toBe(HR);
    expect(desk).not.toHaveProperty("modelId");
    expect(desk).not.toHaveProperty("provider");
    // A ticket session of that employee opens the same way — the default is read per session.
    const t = await service.createTicket(
      P,
      ORG,
      { title: "Staff the company", owner: `agent:${HR}` },
      { userId: "alice" },
    );
    await service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice" });
    const work = created.at(-1)!;
    expect(work.agentId).toBe(HR);
    expect(work).not.toHaveProperty("modelId");
    // A model the board asked for by name still travels with the hire.
    await service.hire(P, ORG, {
      newAgent: { agentId: `${ORG}_dev` },
      title: "Developer",
      reportsTo: CEO,
      model: { provider: "custom", modelId: "m-bench" },
    });
    expect(created.at(-1)).toMatchObject({
      agentId: `${ORG}_dev`,
      provider: "custom",
      modelId: "m-bench",
    });
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

  it("hires with the company plugins plus the extra ones asked for, in order and without repeats", async () => {
    await createOrg();
    await service.hire(P, ORG, {
      newAgent: { agentId: HR, plugins: ["web-design", "agent-company"] },
      title: "Designer",
      reportsTo: CEO,
    });
    // The extras add to the pair rather than replace it: the brief written at hire time tells
    // the newcomer to follow the company-employee skill, and the pass that keeps plugins
    // current installs nothing an employee does not already carry — so an employee hired
    // without agent-company is one nothing repairs.
    expect(agentsCreated.find((a) => a.agentId === HR)?.plugins).toEqual([
      "agent-company",
      "agent-development",
      "web-design",
    ]);
  });

  describe("settings", () => {
    it("refuses a value the config parser would reject, rather than writing one that stops the organization", async () => {
      await createOrg();
      for (const req of [
        { mentionChainLimit: 101 },
        { mentionChainLimit: -1 },
        { mentionChainLimit: 1.5 },
        { budgetWarnRatio: 0 },
        { budgetPauseRatio: 11 },
      ]) {
        await expect(service.patch(P, ORG, req, "alice")).rejects.toMatchObject({ status: 400 });
      }
      // The bounds themselves still pass, and the file stays readable.
      expect(
        await service.patch(P, ORG, { mentionChainLimit: 100, budgetPauseRatio: 10 }, "alice"),
      ).toMatchObject({ mentionChainLimit: 100, budgetPauseRatio: 10 });
      expect((await service.detail(P, ORG, "alice")).invalid).toBeUndefined();
    });

    it("repairs a config that no longer parses, and leaves a readable one's creator alone", async () => {
      await createOrg();
      const configPath = path.join(orgDir(), "org_config.toml");
      // Parsable TOML the config parser refuses: the organization loads with every field
      // defaulted, `created_by` empty among them, and its automation is held.
      await fs.writeFile(configPath, 'name = "Acme"\nmission = 7\n', "utf8");
      expect((await service.detail(P, ORG, "alice")).invalid).toContain("org_config.toml");

      const repaired = await service.patch(P, ORG, { mission: "Build it" }, "bob");
      // Written back with an empty `created_by` the file would not parse either, and the
      // settings page would report success over an organization that is still stopped.
      expect(repaired.createdBy).toBe("bob");
      expect((await service.detail(P, ORG, "alice")).invalid).toBeUndefined();

      const later = await service.patch(P, ORG, { mission: "Build it twice" }, "carol");
      expect(later.createdBy).toBe("bob");
    });
  });

  describe("employee workspaces", () => {
    it("gives a hire with no workspace its own sub-directory, and still takes an explicit `.`", async () => {
      await createOrg();
      const item = await service.hire(P, ORG, {
        newAgent: { agentId: HR },
        title: "HR",
        reportsTo: CEO,
      });
      expect(item.workspace).toBe(HR);
      expect(item.resolvedWorkspace).toBe(path.join(orgDir(), "workspace", HR));
      expect((await fs.stat(path.join(orgDir(), "workspace", HR))).isDirectory()).toBe(true);
      const desk = await service.desk(P, ORG, HR, {});
      expect(desk.workspace).toBe(path.join(orgDir(), "workspace", HR));
      // The shared root is nobody's desk by default, but it is still assignable on request.
      const asked = await service.hire(P, ORG, {
        newAgent: { agentId: "acme_ops" },
        title: "Ops",
        reportsTo: CEO,
        workspace: ".",
      });
      expect(asked.workspace).toBe(".");
      expect(asked.resolvedWorkspace).toBe(path.join(orgDir(), "workspace"));
    });

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
      const settings = await service.patch(P, ORG, { language: "zh" }, "alice");
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

    it("opens desk and ticket sessions under the organization's approval mode", async () => {
      await createOrg();
      await service.patch(P, ORG, { approvalMode: "read-only" }, "alice");
      // A desk opened after the change carries the mode; the row is what the session
      // runtime reads per decision (with `client: "org"`, a call that mode would hand to a
      // person is denied at once — see session-manager.test.ts).
      const desk = (await service.desk(P, ORG, CEO, { renew: true })).sessionId;
      expect(sessions.findById(desk)?.approvalMode).toBe("read-only");
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
      expect(sessions.findById(work)?.approvalMode).toBe("read-only");
    });

    it("carries a changed approval mode onto the sessions it already has, except archived ones", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      // Everything here is opened under the default mode: the CEO's first desk, kept in the
      // ledger as history once renewed, the current CEO and HR desks, and two sessions on one
      // ticket, the second of which a person archives.
      const firstDesk = (await service.desk(P, ORG, CEO, {})).sessionId;
      const ceoDesk = (await service.desk(P, ORG, CEO, { renew: true })).sessionId;
      const hrDesk = (await service.desk(P, ORG, HR, {})).sessionId;
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Ship it", owner: `agent:${CEO}` },
        { userId: "alice" },
      );
      const start = async (): Promise<string> =>
        (await service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice" })).sessionId;
      const work = await start();
      const archived = await start();
      sessions.setArchived(archived, new Date(nowMs).toISOString());
      const live = [firstDesk, ceoDesk, hrDesk, work];
      const modeOf = (sessionId: string) => sessions.findById(sessionId)?.approvalMode;
      expect([...live, archived].map(modeOf)).toEqual(Array(5).fill("allow-all"));

      await service.patch(P, ORG, { approvalMode: "read-only" }, "alice");
      expect(live.map(modeOf)).toEqual(Array(4).fill("read-only"));
      expect(modeOf(archived)).toBe("allow-all");

      // A write that leaves the mode where it is touches no session, so a desk whose mode was
      // changed from its own composer keeps it until the organization's mode next changes.
      sessions.updateApprovalMode(hrDesk, "deny-all");
      await service.patch(P, ORG, { name: "Acme Inc", approvalMode: "read-only" }, "alice");
      expect(modeOf(hrDesk)).toBe("deny-all");
      await service.patch(P, ORG, { approvalMode: "allow-all" }, "alice");
      expect(live.map(modeOf)).toEqual(Array(4).fill("allow-all"));
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

    it("hands a claim in review to a reviewer: the owner's ticket session starts the review, and the reviewer's session sends the ticket back", async () => {
      await createOrg();
      const REVIEWER = `${ORG}_reviewer`;
      await service.hire(P, ORG, {
        newAgent: { agentId: HR },
        title: "Researcher",
        reportsTo: CEO,
      });
      await service.hire(P, ORG, {
        newAgent: { agentId: REVIEWER },
        title: "Reviewer",
        reportsTo: CEO,
      });
      const hrDesk = (await service.desk(P, ORG, HR, {})).sessionId;
      const reviewerDesk = (await service.desk(P, ORG, REVIEWER, {})).sessionId;
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Dependency eval", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, { userId: "alice" });
      const loop = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        {},
        { userId: "alice", sessionId: hrDesk },
      );

      // The author's ticket session moves the claim to review. The reviewer's desk may not
      // open a session on a ticket it does not own …
      const author = { userId: "alice", sessionId: loop.sessionId };
      await service.moveTicket(P, ORG, t.ticketId, "review", undefined, author);
      await expect(
        service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice", sessionId: reviewerDesk }),
      ).rejects.toMatchObject({ status: 403, code: "not_ticket_owner" });

      // … so the author's ticket session starts the round, which runs as the reviewer in the
      // reviewer's own partition.
      const review = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        { agentId: REVIEWER, message: "Review round 1" },
        author,
      );
      expect(sessions.findById(review.sessionId)).toMatchObject({
        agentId: REVIEWER,
        workspace: path.join(orgDir(), "workspace", REVIEWER),
      });

      // The reviewer's session writes its verdict and sends the ticket back to the owner.
      const reviewer = { userId: "alice", sessionId: review.sessionId };
      await service.progressTicket(P, ORG, t.ticketId, "Round 1: major revision", reviewer);
      const back = await service.moveTicket(P, ORG, t.ticketId, "in_progress", undefined, reviewer);
      expect(back.status).toBe("in_progress");
      expect(back.sessions).toEqual([loop.sessionId, review.sessionId]);
      expect(back.history.slice(-2).map((h) => [h.by, h.action])).toEqual([
        [`agent:${REVIEWER}`, "progress"],
        [`agent:${REVIEWER}`, "moved"],
      ]);
    });

    it("leaves nothing on the ticket when the session cannot be started", async () => {
      await createOrg();
      const ceoDesk = (await service.desk(P, ORG, CEO, {})).sessionId;
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Ship it", owner: `agent:${CEO}` },
        { userId: "alice" },
      );
      startFails = true;
      await expect(
        service.startTicket(P, ORG, t.ticketId, {}, { userId: "alice", sessionId: ceoDesk }),
      ).rejects.toMatchObject({ status: 409, code: "ticket_session_failed" });
      // A session that never ran is not the ticket's: listed in `Sessions`, in the history or
      // in the cache it would be counted by the spend and by the next session's `#n`, and a
      // later chat in it would book its cost to this ticket and this employee.
      const filed = await service.ticket(P, ORG, t.ticketId);
      expect(filed.sessions).toEqual([]);
      expect(filed.history.some((h) => h.action === "session_started")).toBe(false);
      expect(cache.ticketSessions(P, ORG)).toEqual([]);
      // So the retry is the ticket's first session, not its second.
      startFails = false;
      const retry = await service.startTicket(
        P,
        ORG,
        t.ticketId,
        {},
        { userId: "alice", sessionId: ceoDesk },
      );
      expect((await service.ticket(P, ORG, t.ticketId)).sessions).toEqual([retry.sessionId]);
      expect(sessions.findById(retry.sessionId)?.title).toBe("Ship it #1");
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
      // A ticket whose file was moved by hand carries no closing entry at all.
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
          .filter((line) => !line.includes("action: moved"))
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

      await service.patch(P, ORG, { status: "paused" }, "alice");
      nowMs = T0 + 2 * DAY + 1;
      await scheduler.tickOnce();
      expect(started).toHaveLength(1);
      expect((await service.calendar(P, ORG)).events[0]!.lastOutcome).toBe("paused");
      expect((await service.calendar(P, ORG)).events[0]!.paused).toBe(true);
      await service.patch(P, ORG, { status: "active" }, "alice");

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

    it("creates in proposed with an owner, queues the assignment, and opens ticket sessions that contribute", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Launch the site", goal: "Ship it", owner: `agent:${HR}`, priority: "P1" },
        { userId: "alice" },
      );
      expect(t.ticketId).toMatch(/^2026-09-01-launch-the-site$/);
      expect(t.status).toBe("proposed");
      // Filed by alice for HR: the owner is the employee, and the history says who filed it.
      expect(t.owner).toBe(`agent:${HR}`);
      expect(t.notify).toEqual([`agent:${HR}`]);
      expect(t.history.map((h) => [h.by, h.action, h.note ?? ""])).toEqual([
        ["user:alice", "created", ""],
        ["user:alice", "assigned", `agent:${HR}`],
      ]);
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
      expect(work!.text).toContain("---\ntitle: Launch the site\nstatus: proposed\n");
      expect(detail.history.at(-1)).toMatchObject({ action: "session_started", note: sessionId });
      // Where it stands, and the rule that makes its output findable by a colleague.
      expect(work!.text).toContain(
        `Workspace: ${path.join(orgDir(), "workspace", HR)} — the organization is at \`<app_data_dir>/organizations/${ORG}/\`.`,
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
      // The section is prose; who wrote it and when is the history entry beside it.
      expect(withProgress.progress).toEqual(["half done"]);
      expect(withProgress.history.at(-1)).toMatchObject({
        by: `agent:${HR}`,
        action: "progress",
        note: "half done",
      });
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
      await service.patch(P, ORG, { status: "paused" }, "alice");
      nowMs = T0 + DAY + 1000;
      await scheduler.tickOnce();
      expect(started).toHaveLength(0);
      expect((await service.calendar(P, ORG)).events[0]!.lastOutcome).toBe("paused");
      await service.patch(P, ORG, { status: "active" }, "alice");

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

    it("moves between columns, queues done for Notify, and rejects need a reason", async () => {
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
      // Notify = CEO and the owner HR: both are queued for their own next sweep. Neither is
      // a run, and no line is written into the all-hands channel — the board is read from
      // the board.
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
      expect(
        allHands.messages.filter((m) => m.sender === "system" && m.text.includes(t.ticketId)),
      ).toEqual([]);
      expect(events.some((e) => e.type === "org_ticket" && e.change === "status:done")).toBe(true);
      const board = await service.tickets(P, ORG);
      expect(board.columns.done.map((x) => x.ticketId)).toEqual([t.ticketId]);
      // The closing move is in the history, which is where the overview reads `closedAt`.
      const closed = await service.ticket(P, ORG, t.ticketId);
      expect(closed.history.at(-1)).toMatchObject({ action: "moved", note: "done" });
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

    it("attaches only a session of an employee, so nothing spends where no budget can see it", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Fix the footer", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      const stranger = "session-2026-09-01-02-00-00-00000099";
      const at = new Date(nowMs).toISOString();
      sessions.insert({
        sessionId: stranger,
        projectId: P,
        agentId: "outsider",
        provider: "custom",
        modelId: "m-bench",
        workspace: root,
        approvalMode: "allow-all",
        title: null,
        client: "web",
        lastActiveAt: at,
        createdAt: at,
      });
      // Spend is summed along the reporting line, so this session's cost would land on the
      // ticket and in nobody's cumulative — past the CEO's cap and past warn and pause.
      await expect(
        service.attachTicket(P, ORG, t.ticketId, stranger, { userId: "alice" }),
      ).rejects.toMatchObject({ status: 400, code: "not_employee_session" });
      expect((await service.ticket(P, ORG, t.ticketId)).sessions).toEqual([]);

      const desk = await service.desk(P, ORG, HR, {});
      await service.attachTicket(P, ORG, t.ticketId, desk.sessionId, { userId: "alice" });
      expect((await service.ticket(P, ORG, t.ticketId)).sessions).toEqual([desk.sessionId]);
    });

    it("refuses a parent that already sits under the ticket", async () => {
      const by = { userId: "alice" };
      const a = await service.createTicket(P, ORG, { title: "Launch the site" }, by);
      const b = await service.createTicket(
        P,
        ORG,
        { title: "Write the copy", parent: a.ticketId },
        by,
      );
      // The cost roll-up memoizes after its recursion, so a two-ticket loop is not broken by
      // the cache: it recurses to the depth bound and both tickets report many times the
      // pair's real spend.
      await expect(
        service.updateTicket(P, ORG, a.ticketId, { parent: b.ticketId }, by),
      ).rejects.toMatchObject({ status: 400 });
      expect((await service.ticket(P, ORG, a.ticketId)).parent).toBeUndefined();

      // A grandchild is refused the same way; re-parenting sideways is not a cycle.
      const c = await service.createTicket(
        P,
        ORG,
        { title: "Shoot the photos", parent: b.ticketId },
        by,
      );
      await expect(
        service.updateTicket(P, ORG, a.ticketId, { parent: c.ticketId }, by),
      ).rejects.toMatchObject({ status: 400 });
      await service.updateTicket(P, ORG, c.ticketId, { parent: a.ticketId }, by);
      expect((await service.ticket(P, ORG, c.ticketId)).parent).toBe(a.ticketId);
    });

    it("files a ticket for another principal, and refuses one nobody holds", async () => {
      const byEmployee = await service.createTicket(
        P,
        ORG,
        { title: "Audit the calendar", owner: HR },
        { userId: "alice" },
      );
      // A bare Agent id is the employee's principal; an employee owner is notified at its desk.
      expect(byEmployee.owner).toBe(`agent:${HR}`);
      expect(byEmployee.notify).toEqual([`agent:${HR}`]);
      expect(byEmployee.history[0]).toMatchObject({ by: "user:alice", action: "created" });
      const prefixed = await service.createTicket(
        P,
        ORG,
        { title: "Audit again", owner: `agent:${CEO}` },
        { userId: "alice" },
      );
      expect(prefixed.owner).toBe(`agent:${CEO}`);
      // No owner named: the caller owns it, and a person is not @-mentioned for its own ticket.
      const byUser = await service.createTicket(
        P,
        ORG,
        { title: "Board request" },
        { userId: "alice" },
      );
      expect(byUser.owner).toBe("user:alice");
      expect(byUser.notify).toEqual([]);
      expect(byUser.history).toEqual([
        { at: new Date(nowMs).toISOString(), by: "user:alice", action: "created" },
      ]);
      for (const owner of ["ghost", `agent:ghost`, "user:mallory", "all"]) {
        await expect(
          service.createTicket(P, ORG, { title: "Nope", owner }, { userId: "alice" }),
        ).rejects.toMatchObject({ status: 400 });
      }
    });

    it("writes no channel line when a ticket closes, whoever Notify names", async () => {
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
      expect(
        allHands.messages.filter((m) => m.sender === "system" && m.text.includes(t.ticketId)),
      ).toEqual([]);
      // The person reads it from the overview's inbox instead, which is built from the board.
      const detail = await service.detail(P, ORG, "alice");
      expect(detail.inbox?.doneTickets.map((x) => x.ticketId)).toEqual([t.ticketId]);
    });

    it("records the operator from the calling Agent id, over the calling session", async () => {
      const t = await service.createTicket(
        P,
        ORG,
        { title: "Trace the writer", owner: `agent:${HR}` },
        { userId: "alice" },
      );
      const ceoDesk = await service.desk(P, ORG, CEO, {});
      // The CEO's desk ran the command, but PENGUIN_AGENT_ID says HR: the narrower fact wins.
      const withProgress = await service.progressTicket(P, ORG, t.ticketId, "looked at it", {
        userId: "alice",
        sessionId: ceoDesk.sessionId,
        agentId: HR,
      });
      expect(withProgress.history.at(-1)).toMatchObject({ by: `agent:${HR}`, action: "progress" });
      // An Agent id that names no employee is ignored; the session answers instead.
      const again = await service.progressTicket(P, ORG, t.ticketId, "and again", {
        userId: "alice",
        sessionId: ceoDesk.sessionId,
        agentId: "ghost",
      });
      expect(again.history.at(-1)).toMatchObject({ by: `agent:${CEO}`, action: "progress" });
    });

    it("names a ticket whose title carries no English through the Project's model", async () => {
      completion.answers = [answered("launch-the-site")];
      const t = await service.createTicket(P, ORG, { title: "上线站点" }, { userId: "alice" });
      expect(t.ticketId).toBe("2026-09-01-launch-the-site");
      // `slug` always wins, and is held to the same letters-only rule.
      const explicit = await service.createTicket(
        P,
        ORG,
        { title: "上线站点", slug: "second-site" },
        { userId: "alice" },
      );
      expect(explicit.ticketId).toBe("2026-09-01-second-site");
      await expect(
        service.createTicket(P, ORG, { title: "x", slug: "site-2" }, { userId: "alice" }),
      ).rejects.toMatchObject({ status: 400 });
      // No usable answer from the model, twice: the caller is told to name it.
      completion.answers = [answered("站点"), answered("站点")];
      await expect(
        service.createTicket(P, ORG, { title: "季度财报" }, { userId: "alice" }),
      ).rejects.toMatchObject({ status: 400, code: "slug_required" });
      // A taken id takes a letter, never a digit.
      completion.answers = [answered("launch-the-site")];
      const again = await service.createTicket(P, ORG, { title: "上线站点" }, { userId: "alice" });
      expect(again.ticketId).toBe("2026-09-01-launch-the-site-b");
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

    it("reports a `# Ticket:` file as an invalid file: listed nowhere, refused on write, never rewritten", async () => {
      const valid = await service.createTicket(
        P,
        ORG,
        { title: "Launch the site" },
        { userId: "alice" },
      );
      const headedId = "2026-09-01-legacy-launch";
      const headedPath = ticketPath(orgDir(), headedId, "in_progress");
      const headed = [
        "# Ticket: Legacy launch",
        "",
        "Status: in_progress",
        `Initiator: agent:${CEO}`,
        `Owner: agent:${HR}`,
        "",
        "## Goal",
        "Ship it",
        "",
      ].join("\n");
      await fs.mkdir(path.dirname(headedPath), { recursive: true });
      await fs.writeFile(headedPath, headed, "utf8");
      errors.length = 0;

      // The pass carries on past it and records it.
      await scheduler.tickOnce();
      expect(errors.filter((e) => e.code === "org_ticket_invalid").length).toBeGreaterThan(0);
      // The board lists the valid ticket in its column and the file under invalidFiles only.
      const board = await service.tickets(P, ORG);
      expect(Object.values(board.columns).flatMap((c) => c.map((x) => x.ticketId))).toEqual([
        valid.ticketId,
      ]);
      expect(board.invalidFiles).toEqual([
        {
          path: path.join("tickets", "2026-09", "in_progress", `${headedId}.md`),
          error: "the file must start with `---` (YAML frontmatter)",
        },
      ]);
      // The overview counts it in no column either.
      expect((await service.detail(P, ORG, "alice")).board.in_progress).toBe(0);
      // Not a ticket to read, and a write asks for a repair instead of converting the file.
      await expect(service.ticket(P, ORG, headedId)).rejects.toMatchObject({
        status: 404,
        code: "ticket_not_found",
      });
      await expect(
        service.progressTicket(P, ORG, headedId, "half done", { userId: "alice" }),
      ).rejects.toMatchObject({ status: 409, code: "ticket_invalid" });
      // A new ticket that would take its id takes the next free one instead.
      const next = await service.createTicket(
        P,
        ORG,
        { title: "Legacy launch", slug: "legacy-launch" },
        { userId: "alice" },
      );
      expect(next.ticketId).toBe(`${headedId}-b`);
      expect(await fs.readFile(headedPath, "utf8")).toBe(headed);
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
      // Everything alice did not write is unread; the three lines she posted are not.
      expect(allHands.messages.some((m) => m.sender === "user:alice")).toBe(true);
      expect(allHands.unread).toBe(
        allHands.messages.filter((m) => m.sender !== "user:alice").length,
      );
      await service.markRead(P, ORG, "alice", DEFAULT_CHANNEL_ID, allHands.messages.at(-1)!.id);
      expect(
        (await service.channelMessages(P, ORG, { userId: "alice" }, DEFAULT_CHANNEL_ID, {})).unread,
      ).toBe(0);
    });

    it("the system's own lines and a paused organization deliver nothing", async () => {
      await service.patch(P, ORG, { status: "paused" }, "alice");
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

    it("never counts a person's own lines as unread", async () => {
      const seen = await service.channelMessages(P, ORG, alice, DEFAULT_CHANNEL_ID, {});
      await service.markRead(P, ORG, "alice", DEFAULT_CHANNEL_ID, seen.messages.at(-1)!.id);
      // Posting does not move the read cursor — only the read route does — so alice's own
      // line would otherwise come back as a badge of one against herself.
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "posted from the CLI",
      });
      const mine = await service.channelMessages(P, ORG, alice, DEFAULT_CHANNEL_ID, {});
      expect(mine.messages.at(-1)!.sender).toBe("user:alice");
      expect(mine.unread).toBe(0);

      // A colleague's line in the same place is unread, and names her.
      await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "@user:alice have a look",
        sessionId: ceoDesk,
      });
      expect(await service.channelMessages(P, ORG, alice, DEFAULT_CHANNEL_ID, {})).toMatchObject({
        unread: 1,
        mentionsMe: 1,
      });
      const listed = new Map(
        (await service.channels(P, ORG, alice)).channels.map((c) => [c.channelId, c]),
      );
      expect(listed.get(DEFAULT_CHANNEL_ID)).toMatchObject({ unread: 1, mentionsMe: 1 });
    });

    it("counts unread past the seven newest active days, stopping at the read cursor", async () => {
      const read = await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
        text: "day zero",
        sessionId: ceoDesk,
      });
      await service.markRead(P, ORG, "alice", DEFAULT_CHANNEL_ID, read.id);
      expect((await service.channelMessages(P, ORG, alice, DEFAULT_CHANNEL_ID, {})).unread).toBe(0);

      // Nine more active days, each its own message file. Only days with messages have a
      // file, so a count that stopped after the seven newest would lose the two oldest —
      // and an organization left running for weeks is where that is the normal case.
      for (let day = 1; day <= 9; day++) {
        nowMs = T0 + day * DAY;
        await service.sendChannelMessage(P, ORG, "alice", DEFAULT_CHANNEL_ID, {
          text: `@user:alice day ${day}`,
          sessionId: ceoDesk,
        });
      }
      expect(await service.channelMessages(P, ORG, alice, DEFAULT_CHANNEL_ID, {})).toMatchObject({
        unread: 9,
        mentionsMe: 9,
      });
      const listed = new Map(
        (await service.channels(P, ORG, alice)).channels.map((c) => [c.channelId, c]),
      );
      expect(listed.get(DEFAULT_CHANNEL_ID)).toMatchObject({ unread: 9, mentionsMe: 9 });
      // And the overview's "mentions waiting" is the same walk.
      expect((await service.detail(P, ORG, "alice")).pending.mentions).toBe(9);
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

    it("enforces a zero budget, which nothing can be under", async () => {
      await createOrg();
      await service.hire(P, ORG, {
        newAgent: { agentId: HR },
        title: "HR",
        reportsTo: CEO,
        budget: 0,
      });
      await scheduler.tickOnce();
      // Nothing was spent and the budget is already over: zero is a real budget, not a request
      // to be unbounded, and it reads the 100% `budgetLine` reports for it. The pause is
      // decided before the warning, and neither repeats on the next pass.
      expect(
        events.filter((e) => e.type === "org_budget").map((e) => (e as { state: string }).state),
      ).toEqual(["paused", "warned"]);
      expect((await service.chart(P, ORG)).employees.find((e) => e.agentId === HR)!.state).toBe(
        "paused",
      );
      const finance = await service.finance(P, ORG);
      expect(finance.employees.find((e) => e.agentId === HR)).toMatchObject({
        own: 0,
        budget: 0,
        warned: true,
        paused: true,
      });
      // The CEO's 100 is untouched, so the zero budget is the only one that tripped.
      expect(finance.employees.find((e) => e.agentId === CEO)).toMatchObject({ paused: false });
    });

    it("reports the month asked for, and refuses a month that is not one", async () => {
      await createOrg();
      expect((await service.finance(P, ORG)).period).toBe("2026-09");
      expect((await service.finance(P, ORG, "2026-08")).period).toBe("2026-08");
      // A malformed month is a caller that skipped the route's check; answering it with the
      // current month's figures would be the wrong month reported as the one asked for.
      await expect(service.finance(P, ORG, "2026-13")).rejects.toThrow(/yyyy-mm/);
      await expect(service.finance(P, ORG, "2026-00")).rejects.toThrow(/yyyy-mm/);
    });

    it("reports a ratio for a zero budget, so a paused row is never a meterless one", async () => {
      await createOrg();
      await service.hire(P, ORG, {
        newAgent: { agentId: HR },
        title: "HR",
        reportsTo: CEO,
        budget: 0,
      });
      const desk = await service.desk(P, ORG, HR, {});
      costs.set(desk.sessionId, 3);
      // Zero is a budget everything is already over, so the marks written against it and the
      // meter the row carries have to agree: a `ratio` missing beside warned and paused is a
      // paused employee the finance page cannot explain.
      const at = new Date(nowMs).toISOString();
      cache.markBudget(P, ORG, HR, "2026-09", { warnedAt: at, pausedAt: at });
      expect((await service.finance(P, ORG)).employees.find((e) => e.agentId === HR)).toMatchObject(
        { budget: 0, ratio: 1, warned: true, paused: true },
      );

      // The chart row reads the same convention, and a budget that is not zero is unchanged.
      const chart = await service.chart(P, ORG);
      expect(chart.employees.find((e) => e.agentId === HR)!.spend.ratio).toBe(1);
      expect(chart.employees.find((e) => e.agentId === CEO)!.spend.ratio).toBe(0.03);

      // So does the organization's own spend, measured against the CEO's budget.
      await service.create(P, { orgId: "zero", mission: "Build it", ceoBudget: 0 }, "alice");
      expect((await service.detail(P, "zero", "alice")).spend).toMatchObject({
        budget: 0,
        ratio: 1,
      });
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

    it("opens the new employee's desk as it is hired, and starts no run for it", async () => {
      await createOrg();
      const runsAfterCreation = started.length;
      const item = await service.hire(P, ORG, {
        newAgent: { agentId: HR, name: "HR" },
        title: "HR",
        reportsTo: CEO,
      });
      // The hire's own response already names the desk: the sidebar's row carries a real
      // Session id from the first read, rather than waiting for a trigger to open one.
      const deskSessionId = item.desk?.sessionId;
      expect(deskSessionId).toBeTruthy();
      expect(sessions.findById(deskSessionId!)).toMatchObject({ agentId: HR, client: "org" });
      expect(sessions.findById(deskSessionId!)?.title).toBe(`Name of ${HR}'s desk`);
      expect(created.at(-1)).toMatchObject({
        agentId: HR,
        client: "org",
        workspace: path.join(orgDir(), "workspace", HR),
      });
      // A desk is a Session, not a work run: hiring dispatches nothing to it.
      expect(started).toHaveLength(runsAfterCreation);

      const ledger = (await store.readDesks(orgDir())).parsed;
      expect(ledger.ok && ledger.value[HR]?.sessionId).toBe(deskSessionId);
      const listed = (await service.sessions(P, ORG)).desks.find((d) => d.agentId === HR);
      expect(listed?.sessionId).toBe(deskSessionId);
      expect(cache.ownerOfSession(deskSessionId!)).toMatchObject({ kind: "desk", agentId: HR });
      // Opening it afterwards reuses it rather than opening a second one.
      expect(await service.desk(P, ORG, HR, {})).toMatchObject({
        sessionId: deskSessionId,
        created: false,
      });
    });

    it("provisions a desk the chart names but the ledger does not, and re-opens one whose session is gone", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      const hired = (await service.chart(P, ORG)).employees.find((e) => e.agentId === HR)!;

      // An employee written into the chart by hand — the CEO's file tools, or a person — has
      // no ledger entry at all. The pass opens its desk without any trigger.
      const dev = "acme_dev";
      existingAgents.add(dev);
      await fs.writeFile(
        path.join(orgDir(), "org_chart.yaml"),
        [
          "employees:",
          `  - agent_id: ${CEO}`,
          "    title: CEO",
          "    reports_to: null",
          "    workspace: ceo",
          `  - agent_id: ${HR}`,
          "    title: HR",
          `    reports_to: ${CEO}`,
          `    workspace: ${HR}`,
          `  - agent_id: ${dev}`,
          "    title: Dev",
          `    reports_to: ${CEO}`,
          "    workspace: dev",
          "",
        ].join("\n"),
        "utf8",
      );
      const runs = started.length;
      await scheduler.tickOnce();
      const devDesk = (await service.sessions(P, ORG)).desks.find((d) => d.agentId === dev);
      expect(sessions.findById(devDesk?.sessionId ?? "")).toMatchObject({
        agentId: dev,
        client: "org",
      });
      expect(started).toHaveLength(runs);

      // A desk session deleted by hand (or with its Agent) leaves the ledger naming a Session
      // the server cannot find — which is exactly what the row's messaging binding asks for,
      // and what answered "Session does not exist". The pass opens a fresh one.
      const gone = hired.desk!.sessionId;
      sessions.deleteByAgent(P, HR);
      expect(sessions.findById(gone)).toBeNull();
      expect((await service.sessions(P, ORG)).desks.find((d) => d.agentId === HR)?.sessionId).toBe(
        gone,
      );
      await scheduler.tickOnce();
      const healed = (await service.sessions(P, ORG)).desks.find((d) => d.agentId === HR);
      expect(healed?.sessionId).not.toBe(gone);
      expect(sessions.findById(healed?.sessionId ?? "")).toMatchObject({ agentId: HR });
      // Idempotent: a second pass finds every desk in place and opens nothing.
      const openedSoFar = created.length;
      await scheduler.tickOnce();
      expect(created).toHaveLength(openedSoFar);
    });

    it("records a desk it cannot open and provisions the rest of the chart, paused or not", async () => {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      await service.patch(P, ORG, { status: "paused" }, "alice");

      // Two employees with no desk: one whose Agent is gone (nothing can open it) and one
      // that is fine. A paused organization fires no run, but a desk is not a run.
      const ghost = "acme_ghost";
      const dev = "acme_dev";
      existingAgents.add(dev);
      await fs.writeFile(
        path.join(orgDir(), "org_chart.yaml"),
        [
          "employees:",
          `  - agent_id: ${CEO}`,
          "    title: CEO",
          "    reports_to: null",
          "    workspace: ceo",
          `  - agent_id: ${HR}`,
          "    title: HR",
          `    reports_to: ${CEO}`,
          `    workspace: ${HR}`,
          `  - agent_id: ${ghost}`,
          "    title: Ghost",
          `    reports_to: ${CEO}`,
          "    workspace: ghost",
          `  - agent_id: ${dev}`,
          "    title: Dev",
          `    reports_to: ${CEO}`,
          "    workspace: dev",
          "",
        ].join("\n"),
        "utf8",
      );
      errors.length = 0;
      await scheduler.tickOnce();
      expect(errors.map((e) => e.code)).toContain("org_desk_unavailable");
      expect(errors.some((e) => e.ctx?.agentId === ghost)).toBe(true);
      const desks = (await service.sessions(P, ORG)).desks.map((d) => d.agentId);
      expect(desks).toContain(dev);
      expect(desks).not.toContain(ghost);
    });

    it("pausing keeps every desk session open, and nothing removes an organization", async () => {
      await createOrg();
      const desk = await service.desk(P, ORG, CEO, {});
      // Pause is the whole lifecycle: the organization stays listed and its desk stays open.
      await service.patch(P, ORG, { status: "paused" }, "alice");
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

  describe("employee plugins", () => {
    const OLD = "2026-09-01.1";

    async function orgWithHr(): Promise<void> {
      await createOrg();
      await service.hire(P, ORG, { newAgent: { agentId: HR }, title: "HR", reportsTo: CEO });
      plugins.updated.length = 0;
      errors.length = 0;
    }

    it("reinstalls a company plugin the library has moved past, and leaves the rest alone", async () => {
      await orgWithHr();
      plugins.installed.set(`${HR}:agent-company`, OLD);
      await scheduler.tickOnce();
      expect(plugins.updated).toEqual([{ agentId: HR, plugin: "agent-company" }]);
      expect(plugins.installed.get(`${HR}:agent-company`)).toBe(LIBRARY_VERSION);
      expect(errors).toEqual([]);
    });

    it("writes nothing while every employee is current", async () => {
      await orgWithHr();
      await scheduler.tickOnce();
      expect(plugins.updated).toEqual([]);
      // The same pass run twice stays a no-op: the comparison, not a one-shot flag, is what
      // makes it idempotent.
      await scheduler.tickOnce();
      expect(plugins.updated).toEqual([]);
    });

    it("leaves a plugin the employee does not carry uninstalled", async () => {
      await orgWithHr();
      plugins.installed.delete(`${HR}:agent-development`);
      await scheduler.tickOnce();
      expect(plugins.updated).toEqual([]);
      expect(plugins.installed.has(`${HR}:agent-development`)).toBe(false);
    });

    it("records a failed update and carries on with the rest of the pass", async () => {
      await orgWithHr();
      plugins.installed.set(`${HR}:agent-company`, OLD);
      plugins.installed.set(`${CEO}:agent-company`, OLD);
      plugins.failUpdates.add(`${CEO}:agent-company`);
      await scheduler.tickOnce();
      expect(plugins.updated).toEqual([{ agentId: HR, plugin: "agent-company" }]);
      expect(plugins.installed.get(`${CEO}:agent-company`)).toBe(OLD);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        source: "organization",
        code: "org_plugin_update_failed",
        ctx: { projectId: P, agentId: CEO },
      });
      // Not fatal: the calendar and the caches behind it in the pass still ran.
      expect(await service.list(P)).toHaveLength(1);
    });
  });
});
