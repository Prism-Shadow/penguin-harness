/**
 * The Self-Evolution Workbench as the build ships it: `@penguinharness/rsi-workbench` from the pin,
 * read by the plugin library like any shipped plugin, installed on a new Project's default Agent,
 * compiled and loaded by the workbench host, and reached through the real workbench routes by a
 * member of the Project — no stand-in for the package.
 *
 * - A new Project's default Agent has the `benchmark` workbench from `rsi-workbench`, and the
 *   `benchmark-design` and `agent-evaluation` Skills.
 * - The first request loads it, which writes the seeds and `.seeded` into the Agent's workbench
 *   data; the Example Benchmark is listed from there.
 * - A member (not the owner) creates a Benchmark by hand and deletes it; a package exported and
 *   imported again is the same Benchmark; a case's statement files are listed; an overwriting
 *   import while an evaluation runs is refused 409 `benchmark_busy`.
 * - What the page's Start does — the prompt from the handler, `POST …/agents/:a/sessions`,
 *   `POST /api/sessions/:id/tasks` with the `[use_skills]` block, the task recorded with the
 *   handler — opens the clicker's own `user` conversation, which the model answers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSkillsMessage } from "@prismshadow/amsp/markers";
import { workbenchDataDir } from "@prismshadow/penguin-core";
import type { SessionsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM } from "./live-session.js";
import type { MockLLM } from "./live-session.js";

/** Polls an async condition. */
async function eventually(cond: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("eventually timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface Listed {
  benchmarks: { id: string; title: string; caseCount: number }[];
  dir?: string;
}

// The first request compiles the workbench's handler with the TypeScript compiler.
describe("the Self-Evolution Workbench of a new Project", { timeout: 120_000 }, () => {
  let t: TestApp;
  let mock: MockLLM;
  let projectId: string;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let api: string;

  beforeAll(async () => {
    mock = await startMockLLM(() => "Evaluated.");
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    const ada = await provisionUser(t.app, "ada");
    owner = apiClient(t.app, ada.cookie);
    projectId = `${ada.user.userId}-default_project`;
    const bo = await provisionUser(t.app, "bo");
    expect((await owner.post(`/api/projects/${projectId}/members`, { userId: "bo" })).status).toBe(
      201,
    );
    member = apiClient(t.app, bo.cookie);
    const models = await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [
        {
          provider: "custom",
          modelId: MOCK_MODEL_ID,
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
      ],
    });
    expect(models.status).toBe(200);
    api = `/api/projects/${projectId}/agents/default_agent/workbenches/benchmark/api`;
  }, 120_000);
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  const dataDir = () => workbenchDataDir(t.root, projectId, "default_agent", "benchmark");
  const list = async (): Promise<Listed> => {
    const res = await member.get(`${api}/benchmarks`);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as Listed;
  };

  it("is installed on the default Agent with both Skills", async () => {
    const res = await owner.get(`/api/projects/${projectId}/agents/default_agent/plugins`);
    const body = (await res.json()) as {
      skills: { name: string }[];
      workbenches: { name: string; plugin: string }[];
    };
    expect(body.workbenches).toContainEqual(
      expect.objectContaining({ name: "benchmark", plugin: "rsi-workbench" }),
    );
    expect(body.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["benchmark-design", "agent-evaluation"]),
    );
  });

  it("seeds its data folder on the first load, once", async () => {
    const listed = await list();
    expect(listed.benchmarks.map((b) => b.id)).toContain("example-benchmark");
    expect(listed.dir).toBe(dataDir());
    await expect(fs.access(path.join(dataDir(), ".seeded"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dataDir(), "example-benchmark", "benchmark_config.toml")),
    ).resolves.toBeUndefined();
  });

  it("lets a member create a Benchmark by hand and delete it", async () => {
    const created = await member.post(`${api}/benchmarks`, {
      id: "member-made",
      title: "Member made",
      cases: [
        { id: "CASE-001", title: "One", statement: "Do one thing.", rubric: "1 if done, else 0." },
      ],
    });
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await list()).benchmarks.find((b) => b.id === "member-made")).toMatchObject({
      title: "Member made",
      caseCount: 1,
    });

    const removed = await member.delete(`${api}/benchmarks/member-made`);
    expect(removed.status).toBeLessThan(300);
    expect((await list()).benchmarks.map((b) => b.id)).not.toContain("member-made");
  });

  it("exports a package and imports it back as the same Benchmark", async () => {
    const exported = await member.get(`${api}/benchmarks/example-benchmark/archive`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("application/zip");
    const zip = Buffer.from(await exported.arrayBuffer());
    const before = (await list()).benchmarks.find((b) => b.id === "example-benchmark")!;

    expect((await member.delete(`${api}/benchmarks/example-benchmark`)).status).toBeLessThan(300);
    const imported = await member.post(`${api}/benchmarks/archive`, {
      dataBase64: zip.toString("base64"),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);

    const after = (await list()).benchmarks.find((b) => b.id === "example-benchmark");
    expect(after).toMatchObject({ title: before.title, caseCount: before.caseCount });
  });

  it("lists a case's statement files", async () => {
    const cases = (await (
      await member.get(`${api}/benchmarks/example-benchmark/cases`)
    ).json()) as { cases: { id: string }[] };
    expect(cases.cases.length).toBeGreaterThan(0);
    const files = await member.get(
      `${api}/benchmarks/example-benchmark/cases/${cases.cases[0]!.id}/files`,
    );
    expect(files.status, await files.clone().text()).toBe(200);
    expect(JSON.stringify(await files.json())).toContain("README.md");
  });

  it("refuses to overwrite a Benchmark while one of its evaluations runs", async () => {
    const zip = Buffer.from(
      await (await member.get(`${api}/benchmarks/example-benchmark/archive`)).arrayBuffer(),
    );
    const running = path.join(dataDir(), "example-benchmark", ".jobs", "job-1.agent-state.tar.gz");
    await fs.mkdir(path.dirname(running), { recursive: true });
    await fs.writeFile(running, "");

    const res = await member.post(`${api}/benchmarks/archive`, {
      dataBase64: zip.toString("base64"),
      overwrite: true,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("benchmark_busy");
    await fs.rm(running);
  });

  it("starts a task the page's way as the clicker's own user conversation", async () => {
    const prompt = await member.post(`${api}/prompt`, {
      kind: "evaluate",
      benchmarkId: "example-benchmark",
      targetAgentId: "default_agent",
      runs: 1,
    });
    expect(prompt.status, await prompt.clone().text()).toBe(200);
    const built = (await prompt.json()) as { prompt: string; skills: string[] };
    expect(built.prompt).toContain(path.join(dataDir(), "example-benchmark"));

    const created = await member.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      approvalMode: "allow-all",
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const sessionId = ((await created.json()) as { session: { sessionId: string } }).session
      .sessionId;
    const sent = await member.post(`/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text: buildSkillsMessage(built.skills, built.prompt) }],
    });
    expect(sent.status, await sent.clone().text()).toBeLessThan(300);
    const recorded = await member.post(`${api}/tasks`, {
      sessionId,
      kind: "evaluate",
      benchmarkId: "example-benchmark",
      agentId: "default_agent",
      approvalMode: "allow-all",
    });
    expect(recorded.status, await recorded.clone().text()).toBeLessThan(300);

    await eventually(async () => mock.requests.length > 0);
    const sessions = (await (
      await member.get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as SessionsResponse;
    expect(sessions.sessions.find((s) => s.sessionId === sessionId)).toMatchObject({
      source: "user",
      approvalMode: "allow-all",
    });
    const tasks = (await (await member.get(`${api}/tasks`)).json()) as {
      tasks: { sessionId: string; kind: string }[];
    };
    expect(tasks.tasks).toContainEqual(expect.objectContaining({ sessionId, kind: "evaluate" }));
  });
});
