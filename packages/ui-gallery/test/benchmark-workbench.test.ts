/**
 * The Self-Evolution Workbench's handler as the demo answers it, through the fetch path its page's
 * requests take (the page's same-origin `fetch`, handed to the frame's by workbench-requests.js).
 *
 * - Given the default Agent, which has the workbench, its Benchmarks list with their folders in
 *   that workbench's data; an Agent without the workbench answers 404.
 * - Given a seeded Benchmark, its cases come five to a page with the total, a case's statement
 *   README opens for preview as the seed wrote it, and its rubric lists its README.
 * - Given a member, a Benchmark made by hand lists, a second one of the same id is refused with
 *   `benchmark_exists`, and a delete removes it; a package import is refused as the demo's
 *   read-only answer.
 * - Given a Start of Optimize, the request names the Benchmark's folder and preselects the
 *   optimizer and the evaluator; the conversation it opens on the Agent runs, and the task the page
 *   records lists first on that Benchmark.
 */
import { describe, expect, it } from "vitest";
import type {
  BenchmarkCasesResponse,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  CaseFilesResponse,
  PromptResponse,
  TasksResponse,
} from "../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/api";
import type { SessionCreateResponse, SessionResponse } from "@prismshadow/penguin-server/api";
import { READ_ONLY } from "../src/app/mock/errors";
import { answerAsResponse } from "../src/app/mock/fetch-shim";
import { IDS } from "../src/app/mock/ids";
import type { Method } from "../src/app/mock/router";
import { resetStore } from "../src/app/mock/store";

const mount = (agentId: string = IDS.agents.general) =>
  `/api/projects/${IDS.project}/agents/${agentId}/workbenches/benchmark/api`;

/** A refusal, in the handler's shape. */
interface Refusal {
  error: { code: string; message: string };
}

/** A request as the page sends it, and its answer as the page reads it, in the contract's shape. */
async function send<T = Refusal>(method: Method, url: string, body?: unknown) {
  const response = await answerAsResponse(method, url, body);
  const text = response.status === 204 ? "" : await response.text();
  const json: unknown = text.startsWith("{") ? JSON.parse(text) : undefined;
  return { status: response.status, text, body: json as T };
}

describe("the Self-Evolution Workbench's handler", () => {
  it("lists the default Agent's Benchmarks in its workbench data, and no other Agent's", async () => {
    resetStore({ lang: "en", signedIn: true });
    const listed = await send<BenchmarksResponse>("GET", `${mount()}/benchmarks`);
    expect(listed.status).toBe(200);
    const { benchmarks, dir } = listed.body;
    expect(dir).toMatch(new RegExp(`/agents/${IDS.agents.general}/app/data/benchmark$`));
    expect(benchmarks.map((b) => b.id)).toEqual(
      expect.arrayContaining([IDS.benchmarks.docs, IDS.benchmarks.builtin]),
    );
    for (const benchmark of benchmarks) expect(benchmark.dir).toBe(`${dir}/${benchmark.id}`);
    expect((await send("GET", `${mount(IDS.agents.docs)}/benchmarks`)).status).toBe(404);
  });

  it("pages a seeded Benchmark's cases and opens a case's files", async () => {
    resetStore({ lang: "en", signedIn: true });
    const one = `${mount()}/benchmarks/${IDS.benchmarks.builtin}`;
    const all = (await send<BenchmarkCasesResponse>("GET", `${one}/cases`)).body.cases;
    expect(all.length).toBeGreaterThan(5);
    const second = await send<BenchmarkCasesResponse>("GET", `${one}/cases?page=2`);
    expect(second.body).toEqual({ cases: all.slice(5, 10), total: all.length });
    expect((await send("GET", `${one}/cases?page=0`)).status).toBe(400);

    const first = all[0]!;
    const statement = await send<CaseFilesResponse>("GET", `${one}/cases/${first.id}/files?path=`);
    expect(statement.body.entries).toEqual([
      expect.objectContaining({ name: "README.md", kind: "file" }),
    ]);
    const readme = await send(
      "GET",
      `${one}/cases/${first.id}/files/content?path=README.md&preview=1`,
    );
    expect(readme.status).toBe(200);
    expect(readme.text).toContain(first.title);
    const rubric = await send<CaseFilesResponse>(
      "GET",
      `${one}/cases/${first.id}/rubric/files?path=`,
    );
    expect(rubric.body.entries.map((e) => e.name)).toEqual(["README.md"]);
    expect((await send("GET", `${one}/cases/CASE-404/files?path=`)).status).toBe(404);
  });

  it("lets a member create and delete a Benchmark, and refuses an id that is taken", async () => {
    resetStore({ lang: "en", signedIn: true, member: true });
    const made = {
      id: "hand-made",
      title: "Hand-made",
      cases: [{ id: "CASE-001-one", title: "One", statement: "Do one thing.", rubric: "Did it." }],
    };
    const created = await send<BenchmarkCreateResponse>("POST", `${mount()}/benchmarks`, made);
    expect(created.status).toBe(201);
    expect(created.body.benchmark).toMatchObject({
      id: "hand-made",
      status: "published",
      origin: { kind: "manual" },
      caseCount: 1,
    });
    const ids = async () =>
      (await send<BenchmarksResponse>("GET", `${mount()}/benchmarks`)).body.benchmarks.map(
        (b) => b.id,
      );
    expect(await ids()).toContain("hand-made");
    const again = await send("POST", `${mount()}/benchmarks`, made);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("benchmark_exists");
    expect((await send("DELETE", `${mount()}/benchmarks/hand-made`)).status).toBe(204);
    expect(await ids()).not.toContain("hand-made");

    const imported = await send("POST", `${mount()}/benchmarks/archive`, { dataBase64: "UEs=" });
    expect(imported.status).toBe(409);
    expect(imported.body.error.code).toBe(READ_ONLY);
  });

  it("starts an Optimize the way the page does and lists it on its Benchmark", async () => {
    resetStore({ lang: "en", signedIn: true });
    const { dir } = (await send<BenchmarksResponse>("GET", `${mount()}/benchmarks`)).body;
    const built = await send<PromptResponse>("POST", `${mount()}/prompt`, {
      kind: "optimize",
      language: "en",
      benchmarkId: IDS.benchmarks.docs,
      targetAgentId: IDS.agents.docs,
      method: "default-rsi-toolkit",
      testedModel: { provider: "deepseek", modelId: "deepseek-flash" },
      roundLimit: 2,
      targetScore: 85,
    });
    expect(built.body.prompt).toContain(`${dir}/${IDS.benchmarks.docs}`);
    expect(built.body.skills).toEqual(["agent-optimization", "agent-evaluation"]);
    expect(built.body.required).toEqual(built.body.skills);

    const agent = `/api/projects/${IDS.project}/agents/${IDS.agents.general}`;
    const opened = await send<SessionCreateResponse>("POST", `${agent}/sessions`, {
      approvalMode: "allow-all",
    });
    expect(opened.status).toBe(201);
    const sessionId = opened.body.session.sessionId;
    const sent = await send("POST", `/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text: built.body.prompt }],
    });
    expect(sent.status).toBe(202);
    try {
      const session = await send<SessionResponse>("GET", `/api/sessions/${sessionId}`);
      expect(session.body.session.status).toBe("running");
      const recorded = await send("POST", `${mount()}/tasks`, {
        sessionId,
        kind: "optimize",
        benchmarkId: IDS.benchmarks.docs,
        agentId: IDS.agents.general,
        approvalMode: "allow-all",
      });
      expect(recorded.status).toBe(201);
      const listed = await send<TasksResponse>(
        "GET",
        `${mount()}/tasks?benchmarkId=${IDS.benchmarks.docs}`,
      );
      expect(listed.body.tasks[0]).toMatchObject({ sessionId, kind: "optimize" });
      expect(listed.body.tasks.map((t) => t.sessionId)).toContain(IDS.sessions.optimize);
    } finally {
      await send("POST", `/api/sessions/${sessionId}/abort`);
    }
  });
});
