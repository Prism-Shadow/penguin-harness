/**
 * `POST /api/projects/:p/suggest-id` over the real app: one route proposes the id of every
 * kind a create dialog names. Each kind gets the id shape its create route accepts (a
 * non-admin's Project in the caller's namespace, a kebab-case Benchmark), steps around every
 * name that create route refuses (every Project, the Project's Agents, its Benchmarks — a
 * folder no list shows included), asks only whoever that create route admits, and falls
 * through model → slug → placeholder. `org` and `channel` delegate to the organization
 * service. The model is never reached: the Project's utility completion is replaced by a
 * scripted one for every case.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentsDir, benchmarksDir } from "@prismshadow/penguin-core";
import type {
  AgentsResponse,
  BenchmarkCreateRequest,
  BenchmarksResponse,
  ProjectsResponse,
  SemanticIdSuggestResponse,
} from "../src/api/types.js";
import type { UtilityCompletion } from "../src/services/project-config-service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const answered = (text: string): UtilityCompletion => ({ ok: true, text });
const failed = (error: string): UtilityCompletion => ({ ok: false, cause: "failed", error });
const NO_MODEL: UtilityCompletion = {
  ok: false,
  cause: "no_model",
  error: "the Project names no default model",
};

/** Today's `yyyymmdd`, which is what a placeholder carries. */
function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

const benchmarkBody = (id: string): BenchmarkCreateRequest => ({
  id,
  title: "Report writing",
  runs: 1,
  cases: [{ id: "CASE-001-x", title: "X", statement: "Do X.", rubric: "- 100 pts: X." }],
});

describe("suggest-id routes", () => {
  let t: TestApp;
  let completion: { prompts: string[]; answers: UtilityCompletion[] };
  let owner: ReturnType<typeof apiClient>;
  const project = "olivia-default_project";
  const url = `/api/projects/${project}/suggest-id`;

  const suggest = async (
    client: ReturnType<typeof apiClient>,
    body: unknown,
    route = url,
  ): Promise<SemanticIdSuggestResponse> => {
    const res = await client.post(route, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as SemanticIdSuggestResponse;
  };

  beforeEach(async () => {
    t = await createTestApp();
    completion = { prompts: [], answers: [] };
    // Every proposal in this suite goes through here; nothing reaches a provider.
    t.deps.projectConfigService.completeOnce = async (_projectId, prompt) => {
      completion.prompts.push(prompt);
      return completion.answers.shift() ?? NO_MODEL;
    };
    owner = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("proposes an Agent id from the model's answer and steps around the Project's Agents", async () => {
    completion.answers = [answered("`report_writer`\n")];
    expect(await suggest(owner, { name: "报告写手", kind: "agent" })).toEqual({
      id: "report_writer",
      source: "model",
    });
    // No prefix to warn about, and the ask names the name.
    expect(completion.prompts[0]).toContain("snake_case");
    expect(completion.prompts[0]).toContain("Name: 报告写手");
    expect(completion.prompts[0]).not.toContain("prefix");

    expect(
      (await owner.post(`/api/projects/${project}/agents`, { agentId: "report_writer" })).status,
    ).toBe(201);
    completion.answers = [answered("report_writer")];
    expect(await suggest(owner, { name: "报告写手", kind: "agent" })).toEqual({
      id: "report_writer_2",
      source: "model",
    });
    // The Project's own Agents are avoided without being read out to the model.
    expect(completion.prompts[1]).not.toContain("taken");
  });

  it("asks again with the format spelled out, then falls back to the slug and records why", async () => {
    completion.answers = [answered("我建议叫「报告写手」"), answered("report_writer")];
    expect(await suggest(owner, { name: "Report Writer", kind: "agent" })).toEqual({
      id: "report_writer",
      source: "model",
    });
    expect(completion.prompts[1]).toContain("Answer with the identifier only");
    expect(t.deps.errorsRepo.recent(project)).toEqual([]);

    completion.answers = [failed("401 invalid api key")];
    expect(await suggest(owner, { name: "Report Writer", kind: "agent" })).toEqual({
      id: "report_writer",
      source: "fallback",
    });
    // A request that failed outright is not repeated.
    expect(completion.prompts).toHaveLength(3);
    const recorded = t.deps.errorsRepo.recent(project);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ source: "id_suggest", code: "id_suggest_failed" });
    expect(recorded[0]?.message).toContain('agent id for "Report Writer": 401 invalid api key');
  });

  it("answers a dated placeholder for a name neither the model nor the slug can name", async () => {
    // No default model: nothing is asked twice, and the reason says so.
    expect(await suggest(owner, { name: "报告写手", kind: "agent" })).toEqual({
      id: `agent_${stamp()}`,
      source: "placeholder",
      reason: "no_default_model",
    });
    completion.answers = [answered("报告写手"), answered("写手")];
    expect(await suggest(owner, { name: "官网改版", kind: "project" })).toEqual({
      id: `olivia-project_${stamp()}`,
      source: "placeholder",
      reason: "unusable_answer",
    });
    // A name that carries ASCII is repaired rather than discarded: an Agent id starts with a letter.
    expect(await suggest(owner, { name: "3D Viewer", kind: "agent" })).toEqual({
      id: "agent_3d_viewer",
      source: "fallback",
    });
  });

  it("a Benchmark id is kebab-case, owner-only, and avoids the Project's Benchmarks", async () => {
    completion.answers = [answered("report_writing")];
    expect(await suggest(owner, { name: "报告写作", kind: "benchmark" })).toEqual({
      id: "report-writing",
      source: "model",
    });
    expect(completion.prompts[0]).toContain("kebab-case");
    expect(
      (await owner.post(`/api/projects/${project}/benchmarks`, benchmarkBody("report-writing")))
        .status,
    ).toBe(201);
    completion.answers = [answered("我不知道"), answered("还是不知道")];
    expect(completion.prompts).toHaveLength(1);
    expect(await suggest(owner, { name: "Report Writing", kind: "benchmark" })).toEqual({
      id: "report-writing-2",
      source: "fallback",
    });
    expect(completion.prompts[2]).toContain("digits and hyphens, nothing else");
    expect(await suggest(owner, { name: "报告写作", kind: "benchmark" })).toEqual({
      id: `benchmark-${stamp()}`,
      source: "placeholder",
      reason: "no_default_model",
    });

    // A member may create Agents but not Benchmarks, and is refused the proposal the same way.
    const mia = await provisionUser(t.app, "mia");
    expect((await owner.post(`/api/projects/${project}/members`, { userId: "mia" })).status).toBe(
      201,
    );
    const member = apiClient(t.app, mia.cookie);
    const asked = completion.prompts.length;
    expect((await member.post(url, { name: "Report", kind: "benchmark" })).status).toBe(403);
    expect((await member.post(url, { name: "Report", kind: "agent" })).status).toBe(200);
    expect(completion.prompts).toHaveLength(asked + 1);
  });

  it("a Project id lives in the caller's namespace and avoids every Project on the server", async () => {
    completion.answers = [answered("research_lab")];
    expect(await suggest(owner, { name: "科研实验室", kind: "project" })).toEqual({
      id: "olivia-research_lab",
      source: "model",
    });
    // The namespace is added to the answer, so the model is told not to add one.
    expect(completion.prompts[0]).toContain("Do not add any prefix of your own");
    expect((await owner.post("/api/projects", { projectId: "olivia-research_lab" })).status).toBe(
      201,
    );
    expect(await suggest(owner, { name: "Research Lab", kind: "project" })).toEqual({
      id: "olivia-research_lab_2",
      source: "fallback",
    });

    // The admin's ids are plain, and another owner's Project is still avoided.
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    completion.answers = [answered("default_project")];
    expect(
      await suggest(
        admin,
        { name: "Default project", kind: "project" },
        "/api/projects/default_project/suggest-id",
      ),
    ).toEqual({ id: "default_project_2", source: "model" });
  });

  it("steps around a folder the create route refuses even when no list shows it", async () => {
    // A Benchmark deleted mid-evaluation leaves its directory without a config, an Agent folder
    // can lack system_config.yaml, and a Project directory its row.
    await fs.mkdir(path.join(benchmarksDir(t.root, project), "report-writing", "CASE-001-x"), {
      recursive: true,
    });
    await fs.mkdir(path.join(agentsDir(t.root, project), "report_writer"));
    await fs.mkdir(path.join(t.root, "olivia-research_lab"));
    const benchmarks = (await (
      await owner.get(`/api/projects/${project}/benchmarks`)
    ).json()) as BenchmarksResponse;
    expect(benchmarks.benchmarks.map((b) => b.id)).not.toContain("report-writing");
    const agents = (await (
      await owner.get(`/api/projects/${project}/agents`)
    ).json()) as AgentsResponse;
    expect(agents.agents.map((a) => a.agentId)).not.toContain("report_writer");
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    expect(projects.projects.map((p) => p.projectId)).not.toContain("olivia-research_lab");
    // None of them lists, yet every create route refuses the name.
    expect(
      (await owner.post(`/api/projects/${project}/benchmarks`, benchmarkBody("report-writing")))
        .status,
    ).toBe(409);
    expect(
      (await owner.post(`/api/projects/${project}/agents`, { agentId: "report_writer" })).status,
    ).toBe(409);
    expect((await owner.post("/api/projects", { projectId: "olivia-research_lab" })).status).toBe(
      409,
    );

    expect(await suggest(owner, { name: "Report Writing", kind: "benchmark" })).toEqual({
      id: "report-writing-2",
      source: "fallback",
    });
    expect(await suggest(owner, { name: "Report Writer", kind: "agent" })).toEqual({
      id: "report_writer_2",
      source: "fallback",
    });
    expect(await suggest(owner, { name: "Research Lab", kind: "project" })).toEqual({
      id: "olivia-research_lab_2",
      source: "fallback",
    });
  });

  it("validates the body, and asks nothing of a Project the caller cannot reach", async () => {
    expect((await owner.post(url, { kind: "agent" })).status).toBe(400);
    expect((await owner.post(url, { name: "", kind: "agent" })).status).toBe(400);
    expect((await owner.post(url, { name: "Report" })).status).toBe(400);
    expect((await owner.post(url, { name: "Report", kind: "team" })).status).toBe(400);
    expect((await owner.post(url, { name: "Report", kind: "agent", taken: "x" })).status).toBe(400);
    const stranger = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    // Company mode is on, so an `org` or `channel` 404 can only be the membership check's.
    t.deps.serverSettingsRepo.setCompanyMode(true);
    for (const kind of ["project", "agent", "benchmark", "org", "channel"]) {
      const res = await stranger.post(url, { name: "Report", kind });
      expect(res.status, kind).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code, kind).toBe(
        "project_not_found",
      );
    }
    expect(completion.prompts).toEqual([]);
  });

  it("org and channel go through the organization service, only while company mode is on", async () => {
    const off = await owner.post(url, { name: "科研公司", kind: "org" });
    expect(off.status).toBe(404);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe("company_mode_off");
    expect(completion.prompts).toEqual([]);

    t.deps.serverSettingsRepo.setCompanyMode(true);
    completion.answers = [answered("research_lab")];
    expect(await suggest(owner, { name: "科研公司", kind: "org" })).toEqual({
      id: "co_research_lab",
      source: "model",
    });
    completion.answers = [answered("site")];
    expect(await suggest(owner, { name: "站点", kind: "channel", taken: ["ch_site"] })).toEqual({
      id: "ch_site_2",
      source: "model",
    });
    expect(completion.prompts[1]).toContain("Those answers are taken, prefix included: ch_site.");
    // A dead end of an org or channel proposal is recorded as the organization's.
    completion.answers = [failed("connect ETIMEDOUT")];
    expect(await suggest(owner, { name: "科研公司", kind: "org" })).toEqual({
      id: `co_org_${stamp()}`,
      source: "placeholder",
      reason: "model_failed",
    });
    expect(t.deps.errorsRepo.recent(project)[0]).toMatchObject({
      source: "organization",
      code: "id_suggest_failed",
    });
  });
});
