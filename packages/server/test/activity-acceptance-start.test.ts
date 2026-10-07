/**
 * Run tests, over HTTP: when a test run is refused, when it finishes skipped without a
 * Session, what it stages for its agent, how its results become the report, and when it
 * reuses an earlier run's tests.
 *
 * No browser starts and no model is called: the test browser's "executable" is a file this
 * test writes, and the Session is a fake whose agent writes the files a real one would.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type { ActivityRun, ActivityRunSummary } from "../src/activities/domain.js";
import type { ActivityGenerationService } from "../src/activities/generation.js";
import type { AcceptanceStateResponse } from "../src/activities/acceptance-types.js";
import {
  acceptancePrompt,
  acceptanceReusePrompt,
  activityHarnessSource,
  runAcceptanceSource,
} from "../src/activities/acceptance-harness.js";
import { INSTALL_MARKER } from "../src/activities/test-browser.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { activitySpec, createCheckoutActivity } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";
const CRITERIA = ["Tapping the cat plays its name.", "The end screen says well done."];

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout with one Loom module of two scenes; built unless `built` is false. */
async function checkout(options: { criteria: string[]; built: boolean }): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "waf-acceptance-"));
  await write(path.join(root, "framework", "package.json"), { version: "9.9.9" });
  await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
  await fs.mkdir(path.join(root, "media", "loom"), { recursive: true });
  const spec = {
    ...activitySpec,
    scenes: [
      { id: "intro", description: "Tap the cat" },
      { id: "end", description: "Well done" },
    ],
    ...(options.criteria.length ? { acceptance_criterias: options.criteria } : {}),
  };
  const product = path.join(root, "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    title: "Sight Words",
    canonicalRefNum: 1,
    activityType: "standard",
    moduleFolder: FOLDER,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  await write(path.join(ref, "activity_metadata.json"), { refNum: 1, title: "Sight Words 1" });
  await write(path.join(ref, "activity_spec.json"), spec);
  await write(path.join(ref, "asset_manifest.json"), { assets: { "en-US": [] } });
  await write(path.join(ref, "activity_description.txt"), "Ref 1");
  const module = path.join(root, "modules", FOLDER);
  if (options.built)
    await write(path.join(module, "definition.json"), {
      id: "sightWords",
      require: {
        entry: { type: "javascript", url: "entry.js" },
        layout: { type: "html", url: "layout.html" },
      },
    });
  await write(path.join(module, "package.json"), { version: "1.0.0" });
  await write(path.join(module, "configurations", `${CODE}-1.json`), { sightWords: {} });
  return root;
}

const executableIn = (dir: string) => path.join(dir, "chromium-0000", "chrome");

/** What the fake agent does in its workspace, and what it saw there when it started. */
type Agent = (workspace: string) => Promise<void>;
const writesResults =
  (results: unknown, test = "// the agent's tests\n"): Agent =>
  async (workspace) => {
    await fs.writeFile(path.join(workspace, "acceptance.test.mjs"), test, { flag: "w" });
    await fs.writeFile(
      path.join(workspace, "acceptance-results.json"),
      typeof results === "string" ? results : JSON.stringify(results),
    );
  };

describe("acceptance test runs", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    // Last in, first out: a second setup restores the WAF_ROOT_DIR the first one set, and the
    // first one's cleanup then restores what was there before either.
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup(
    options: { criteria?: string[]; built?: boolean; installed?: boolean } = {},
  ) {
    const root = await checkout({
      criteria: options.criteria ?? CRITERIA,
      built: options.built ?? true,
    });
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = root;
    const t = await createTestApp({
      testBrowserPorts: { locateExecutable: async (dir) => executableIn(dir) },
    });
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    });
    const home = path.join(t.root, "browsers");
    if (options.installed !== false) {
      await write(executableIn(home), "fake browser");
      await write(path.join(home, "chromium-0000", INSTALL_MARKER), "");
    }

    let agent: Agent = writesResults({ results: [] });
    const prompts: string[] = [];
    const seen: string[][] = [];
    const sessions: string[] = [];
    const fakeSession = (row: SessionRow): RuntimeSession => ({
      sessionId: row.sessionId,
      dispose: () => {},
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *compact() {},
      async *run(input) {
        prompts.push(JSON.stringify(input));
        yield requestBegin();
        seen.push((await fs.readdir(row.workspace!)).sort());
        await agent(row.workspace!);
        yield requestEnd("completed");
      },
    });
    const adopt = t.deps.manager.adopt.bind(t.deps.manager);
    vi.spyOn(t.deps.manager, "adopt").mockImplementation((row) => {
      sessions.push(row.sessionId);
      return adopt(row, fakeSession(row));
    });

    const owner = await provisionUser(t.app, "tests_owner");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "tests_owner-tests";
    await client.post("/api/projects", { projectId, name: "Tests" });
    await t.deps.projectConfigService.writeRaw(projectId, {
      default_model: { provider: "custom", model_id: "activity-test" },
      models: [
        {
          provider: "custom",
          model_id: "activity-test",
          api_key: "not-a-real-key",
          base_url: "http://localhost:1/v1",
          client_type: "openai-chat",
        },
      ],
    });
    const activityId = await createCheckoutActivity(client, projectId, root, CODE);
    const endpoint = `/api/projects/${projectId}/activities/${activityId}`;
    const service = t.deps.tree.api<ActivityGenerationService>(
      "ActivitiesModule",
      "ActivityGeneration",
    );
    const revision = async () =>
      ((await (await client.get(endpoint)).json()) as { draft: { contentRevision: string } }).draft
        .contentRevision;
    const start = async () =>
      client.post(`${endpoint}/test`, {
        agentId: "default_agent",
        expectedRevision: await revision(),
      });
    const report = async () => {
      const res = await client.get(`${endpoint}/test-report`);
      expect(res.status).toBe(200);
      return (await res.json()) as AcceptanceStateResponse;
    };
    const runs = async () =>
      ((await (await client.get(`${endpoint}/runs`)).json()) as { runs: ActivityRunSummary[] })
        .runs;
    /** Starts a run and waits until its fake agent has finished and it has been collected. */
    const runToEnd = async (next: Agent) => {
      agent = next;
      const response = await start();
      expect(response.status, await response.clone().text()).toBe(202);
      const run = (await response.json()) as ActivityRun;
      expect(run).toMatchObject({ kind: "test", status: "running" });
      await waitFor(() => t.deps.manager.statusOf(run.sessionId!) === "idle");
      await service.reconcile();
      const settled = (await runs()).find((entry) => entry.runId === run.runId)!;
      return { run, settled, workspace: path.join(t.root, "activity-runs", run.runId) };
    };
    return { t, client, endpoint, start, report, runs, runToEnd, prompts, seen, sessions, home };
  }

  it("finishes skipped without a Session when the specification has no criteria", async () => {
    const { t, start, report, sessions } = await setup({ criteria: [], installed: false });
    const response = await start();
    expect(response.status).toBe(202);
    const run = (await response.json()) as ActivityRun;
    expect(run).toMatchObject({ kind: "test", status: "succeeded", sessionId: null });
    expect(sessions).toEqual([]);
    const state = await report();
    expect(state).toMatchObject({
      runId: run.runId,
      criteria: 0,
      stale: false,
      browserInstalled: false,
    });
    expect(state.report).toMatchObject({
      overallStatus: "skipped",
      skippedReason: "no_criteria",
      results: [],
    });
    const stored = JSON.parse(
      await fs.readFile(
        path.join(t.root, "activity-runs", run.runId, "reports", "test.json"),
        "utf8",
      ),
    );
    expect(stored).toEqual(state.report);
  });

  it("refuses without the test browser or without an assembled module", async () => {
    const missing = await setup({ installed: false });
    expect(await missing.report()).toMatchObject({
      report: null,
      criteria: 2,
      browserInstalled: false,
    });
    const refused = await missing.start();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "test_browser_missing" } });
    expect(missing.sessions).toEqual([]);

    const unbuilt = await setup({ built: false });
    const notBuilt = await unbuilt.start();
    expect(notBuilt.status).toBe(409);
    expect(await notBuilt.json()).toMatchObject({ error: { code: "preview_not_built" } });
    expect(unbuilt.sessions).toEqual([]);
  });

  it("stages the harness, collects results in the criteria's order, and fails a missing one not_run", async () => {
    const { report, runToEnd, prompts, seen, home } = await setup();
    const { run, settled, workspace } = await runToEnd(
      writesResults({
        results: [
          {
            criterion: CRITERIA[1],
            testName: "end screen",
            status: "failed",
            durationMs: 900,
            error: "Expected state end, saw intro.",
          },
        ],
      }),
    );
    expect(settled.status, settled.error ?? "").toBe("succeeded");
    expect(settled.test).toMatchObject({ criteria: CRITERIA, reused: false });

    // What the agent was given, before it wrote anything.
    expect(seen[0]).toEqual(
      expect.arrayContaining([
        "acceptance-input.json",
        "activity-harness.mjs",
        "run-acceptance.mjs",
        "package.json",
        "activity-spec.json",
      ]),
    );
    expect(seen[0]).not.toContain("acceptance.test.mjs");
    expect(prompts[0]).toContain(JSON.stringify(acceptancePrompt).slice(1, 60));
    const input = JSON.parse(
      await fs.readFile(path.join(workspace, "acceptance-input.json"), "utf8"),
    );
    expect(input).toMatchObject({
      criteria: CRITERIA,
      scenes: ["intro", "end"],
      viewport: { width: 640, height: 480 },
      browserPath: executableIn(home),
    });
    expect(input.playUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/preview\/activity\/.+\/play$/);
    expect(await fs.readFile(path.join(workspace, "activity-harness.mjs"), "utf8")).toBe(
      activityHarnessSource,
    );
    expect(await fs.readFile(path.join(workspace, "run-acceptance.mjs"), "utf8")).toBe(
      runAcceptanceSource,
    );
    const pkg = JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8"));
    expect(pkg.dependencies["playwright-core"]).toMatch(/^\d+\.\d+\.\d+/);

    const state = await report();
    expect(state.runId).toBe(run.runId);
    expect(state.report).toMatchObject({ overallStatus: "failed", reused: false });
    expect(state.report!.results).toEqual([
      {
        criterion: CRITERIA[0],
        testName: "",
        status: "failed",
        durationMs: 0,
        error: null,
        code: "not_run",
      },
      {
        criterion: CRITERIA[1],
        testName: "end screen",
        status: "failed",
        durationMs: 900,
        error: "Expected state end, saw intro.",
      },
    ]);
  });

  it("reuses the tests for unchanged criteria, and writes new ones when they change", async () => {
    const { client, endpoint, report, runToEnd, prompts, seen } = await setup();
    const passing = {
      results: CRITERIA.map((criterion) => ({
        criterion,
        testName: criterion,
        status: "passed",
        durationMs: 10,
      })),
    };
    await runToEnd(writesResults(passing, "// written once\n"));

    // Unchanged criteria: the earlier test file is in the workspace before the agent starts,
    // and the agent is told to run it.
    const second = await runToEnd(async (workspace) => {
      expect(await fs.readFile(path.join(workspace, "acceptance.test.mjs"), "utf8")).toBe(
        "// written once\n",
      );
      await fs.writeFile(path.join(workspace, "acceptance-results.json"), JSON.stringify(passing));
    });
    expect(seen[1]).toContain("acceptance.test.mjs");
    expect(prompts[1]).toContain(JSON.stringify(acceptanceReusePrompt).slice(1, 60));
    expect(second.settled.test).toMatchObject({ reused: true });
    const reused = JSON.parse(
      await fs.readFile(path.join(second.workspace, "reports", "test.json"), "utf8"),
    );
    expect(reused).toMatchObject({ overallStatus: "passed", reused: true });
    expect((await report()).stale).toBe(false);

    // A changed criterion: the tests are written again.
    const detail = (await (await client.get(endpoint)).json()) as {
      draft: { contentRevision: string; spec: Record<string, unknown> };
    };
    const saved = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: { ...detail.draft.spec, acceptance_criterias: [...CRITERIA, "It ends."] },
      expectedRevision: detail.draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    // The report now tested an earlier specification.
    expect((await report()).stale).toBe(true);
    const third = await runToEnd(writesResults(passing));
    expect(seen[2]).not.toContain("acceptance.test.mjs");
    expect(third.settled.test).toMatchObject({ reused: false });
    expect((await report()).stale).toBe(false);

    // Handed the tests again, the agent rewrites them: the report does not claim reuse.
    const fourth = await runToEnd(writesResults(passing, "// rewritten\n"));
    expect(seen[3]).toContain("acceptance.test.mjs");
    expect(fourth.settled.test).toMatchObject({ reused: true });
    expect((await report()).report).toMatchObject({ reused: false });
  });

  it("fails the run with a worded error when the results file is malformed or too large", async () => {
    const { report, runToEnd } = await setup();
    const malformed = await runToEnd(writesResults("{ not json"));
    expect(malformed.settled.status).toBe("failed");
    expect(malformed.settled.error).toBe("acceptance-results.json is not valid JSON.");

    const wrong = await runToEnd(writesResults({ results: [{ criterion: "x", status: "ok" }] }));
    expect(wrong.settled.status).toBe("failed");
    expect(wrong.settled.error).toMatch(/status other than passed, failed or skipped/);

    const huge = await runToEnd(writesResults("x".repeat(1024 * 1024 + 1)));
    expect(huge.settled.status).toBe("failed");
    expect(huge.settled.error).toMatch(/no larger than 1048576 bytes/);

    const nothing = await runToEnd(async () => {});
    expect(nothing.settled.status).toBe("failed");
    expect(nothing.settled.error).toBe("The session ended without acceptance-results.json.");
    expect((await report()).report).toBeNull();
  });
});
