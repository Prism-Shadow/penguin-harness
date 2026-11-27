/**
 * A company workflow (test-fixtures/company-workflow) written into an organization through
 * `workflow.write` and loaded by the server's own WorkflowLoader: its guard replaces approve's
 * at once, its after hook follows each approval, and its deploy runs on the subject's commit —
 * in this organization only. A version that does not compile keeps the previous one serving,
 * with the reason; a rollback restores a recorded version. A company contribution takes the place
 * of the built-in one on its key, two of them are ambiguous, and the `workflow.*` Actions stay out
 * of their reach. A hot update builds the registry anew and loads the workflows again, while a
 * run the old registry started ends there.
 *
 * Needs the server's interface table (packages/server/src/ifaces.json, by its gen:ifaces) and
 * this package built (dist/deploy.d.ts, the types the fixture imports).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowLoader } from "@prismshadow/penguin-server/plugin";
import {
  ActionRegistry,
  CompanyWorkflows,
  workflowContributions,
  workflowRoutes,
  type Contributed,
} from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";
import { PLUGIN_DIR, actionApp, proposalContributions, type ActionApp } from "./action-harness.js";
import { DEV, DOC, ORG, PROJECT, QA, fakeOrg } from "./fake-org.js";

const FIXTURE_DIR = path.join(PLUGIN_DIR, "test-fixtures", "company-workflow");
const HEAD = "a".repeat(40);
/** `gh` with one pull request: owner/repo#5 at HEAD. */
const gh: RunGh = async (args) => {
  if (args[1] === "repos/owner/repo/pulls/5") {
    return JSON.stringify({
      head: { sha: HEAD, ref: "feat/x" },
      html_url: "https://github.com/owner/repo/pull/5",
    });
  }
  throw new Error(`unexpected gh ${args.join(" ")}`);
};

/** The fixture's files, as `workflow.write` takes them. */
function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(FIXTURE_DIR)) {
    out[name] = readFileSync(path.join(FIXTURE_DIR, name), "utf8");
  }
  return out;
}

/** A one-guard company workflow: `key`'s guard refused with `code`. */
function guardWorkflow(id: string, key: string, code: string): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: id,
      type: "module",
      penguin: {
        modules: [
          {
            name: "Workflow",
            contributes: {
              "CompanyActionRegistry.actions": [{ id: `${id}.guard`, kind: "guard", key }],
            },
          },
        ],
      },
    }),
    "index.ts": `import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: {
    Workflow: {
      create() {
        const guard = () => () => {
          throw Object.assign(new Error("no"), { status: 403, code: ${JSON.stringify(code)} });
        };
        return { bind: { ${JSON.stringify(`${id}.guard`)}: guard } };
      },
    },
  },
} satisfies WorkflowPackage;
`,
  };
}

/**
 * The server's loader, outside a server: its capabilities stood in for. It is imported from the
 * server's source — the package exports no such entry, and this test means the real one, the
 * one an Agent's workflows go through — by a computed path, so this package's typecheck does
 * not take in the server's sources.
 */
const LOADER_SOURCE = path.join(
  PLUGIN_DIR,
  "..",
  "..",
  "packages",
  "server",
  "src",
  "workflows",
  "loader.ts",
);

async function realLoader(): Promise<WorkflowLoader> {
  const { WorkflowLoaderService } = (await import(LOADER_SOURCE)) as {
    WorkflowLoaderService: new () => WorkflowLoader & { setup(ctx: unknown): void };
  };
  const loader = new WorkflowLoaderService();
  Object.assign(loader, {
    clock: { now: () => new Date() },
    log: { line: () => undefined },
    hmr: { assetsDir: () => null },
  });
  loader.setup({
    resources: { register: () => () => undefined, claim: () => undefined },
    contributions: {},
    effect: () => undefined,
  });
  return loader;
}

// Each `workflow.write` compiles the fixture through the real loader, which costs seconds a
// write on Windows: the same allowance the server's own workflow tests take (workflows.test.ts).
describe("a company workflow", { timeout: 30_000 }, () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let logs: string[];
  let workflows: CompanyWorkflows;
  let a: ActionApp;

  /** The registry of one App over the organization's workflows, with the workflow routes. */
  function app(w: CompanyWorkflows, extra: Contributed[] = [], now?: () => number): ActionApp {
    const made: ActionApp = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      service: org.service,
      contributions: [
        ...proposalContributions(org.service),
        ...workflowContributions(w, (o) => made.registry.skippedIn(o)),
        ...extra,
      ],
      deps: { company: w, ...(now !== undefined ? { now } : {}) },
    });
    made.app.route("/p/:projectId/o/:orgId/workflows", workflowRoutes(made.registry, w));
    return made;
  }

  beforeEach(async () => {
    org = await fakeOrg({ gh });
    logs = [];
    workflows = new CompanyWorkflows({
      loader: await realLoader(),
      root: org.root,
      log: (line) => logs.push(line),
    });
    a = app(workflows);
  });
  afterEach(async () => {
    a.registry.stop();
    workflows.stop();
    await org.cleanup();
  });

  const write = (id: string, files: Record<string, string | null>, replace = true) =>
    a.run("workflow.write", `workflow:${id}`, { files, replace });

  async function readyProposal(): Promise<number> {
    const created = await a.run("proposal.create", "organization", {
      author: "acme_dev",
      brief: "Batch",
    });
    const n = (created.body.result as { number: number }).number;
    expect((await a.run("proposal.publish", `proposal:${n}`, { markdown: DOC }, DEV)).status).toBe(
      200,
    );
    expect((await a.run("proposal.ready", `proposal:${n}`, {}, DEV)).status).toBe(200);
    return n;
  }

  /** Follows a run until it ends. */
  async function settled(
    on: ActionApp,
    id: string,
  ): Promise<{ run: Record<string, unknown>; output: string }> {
    for (let i = 0; i < 400; i++) {
      const got = await on.get(`/runs/${id}`);
      const run = got.body.run as Record<string, unknown>;
      if (run.outcome !== null) return { run, output: got.body.output as string };
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`run ${id} did not end`);
  }

  it("takes effect once written: its guard replaces approve's, its hook follows, in this organization only", async () => {
    const written = await write("fixture", fixtureFiles());
    expect(written.status).toBe(200);
    expect(written.body.result).toMatchObject({ loaded: true, error: null });
    expect((written.body.run as { key: string; subject: string }).subject).toBe("workflow:fixture");
    const n = await readyProposal();
    const refused = await a.run("proposal.approve", `proposal:${n}`, {}, QA);
    expect([refused.status, refused.body.error]).toMatchObject([
      403,
      { code: "qa_does_not_approve" },
    ]);
    // The replacement wraps the default: the proposal's own rules still hold for others.
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, DEV)).status).toBe(200);
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, DEV)).body).toMatchObject({
      error: { code: "proposal_status" },
    });
    expect(logs.filter((l) => l.includes("followed"))).toEqual([
      "[company workflow proj/acme/fixture] followed proposal.approve succeeded agent:acme_dev",
    ]);
    // Another organization has none of it.
    expect(await workflows.contributions({ ...org.gateway.org, orgId: "other" })).toEqual([]);
    const listed = (await a.get("/contributions")).body.contributions as Array<{
      id: string;
      workflow: string | null;
    }>;
    expect(listed.filter((c) => c.workflow === "fixture").map((c) => c.id)).toEqual([
      "fixture.deploy",
      "fixture.approve-guard",
      "fixture.approve-hook",
    ]);
  });

  it("deploys the subject's commit, refuses a head that moved, and keeps the output", async () => {
    await write("fixture", fixtureFiles());
    const listed = (await a.get("/?subject=pr:owner/repo%235")).body.actions as Array<{
      key: string;
      allowed: boolean;
    }>;
    expect(listed.find((x) => x.key === "deploy.fixture")?.allowed).toBe(true);
    const moved = await a.run("deploy.fixture", "pr:owner/repo#5", { expectedHead: "bbbbbbbb" });
    expect([moved.status, moved.body.error]).toMatchObject([409, { code: "head_moved" }]);
    const started = await a.run(
      "deploy.fixture",
      "pr:owner/repo#5",
      { expectedHead: HEAD.slice(0, 12) },
      DEV,
    );
    expect(started.status).toBe(202);
    const run = started.body.run as { id: string; commit: string };
    expect(run.commit).toBe(HEAD);
    const end = await settled(a, run.id);
    expect(end.run).toMatchObject({
      outcome: "succeeded",
      result: { exitCode: 0, head: HEAD },
      via: "session",
    });
    expect(end.output).toContain(`deploying ${HEAD}`);
  });

  it("keeps the previous version serving when an edit does not compile, and rolls back to a recorded one", async () => {
    const good = await write("fixture", fixtureFiles());
    const revision = (good.body.result as { workflow: { revision: string } }).workflow.revision;
    const broken = await write("fixture", { "index.ts": "export default 1 as string;\n" }, false);
    expect(broken.status).toBe(200);
    const result = broken.body.result as {
      loaded: boolean;
      error: string;
      workflow: { serving: string };
    };
    expect(result.loaded).toBe(false);
    expect(result.error).toMatch(/TS\d+/);
    expect(result.workflow.serving).toBe(revision);
    // The previous instance still decides.
    const n = await readyProposal();
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, QA)).status).toBe(403);
    const shown = await a.app.request(`/p/${PROJECT}/o/${ORG}/workflows/fixture`, {
      headers: { "x-user": "boss" },
    });
    expect(await shown.json()).toMatchObject({ error: expect.stringMatching(/TS\d+/) });
    const history = await a.app.request(`/p/${PROJECT}/o/${ORG}/workflows/fixture/history`, {
      headers: { "x-user": "boss" },
    });
    const versions = ((await history.json()) as { versions: Array<{ revision: string }> }).versions;
    expect(versions.map((v) => v.revision)).toEqual([revision]);
    const back = await a.run("workflow.rollback", "workflow:fixture", { revision });
    expect(back.body.result).toMatchObject({
      loaded: true,
      workflow: { revision, serving: revision },
    });
    const missing = await a.run("workflow.rollback", "workflow:fixture", {
      revision: "0123456789ab",
    });
    expect([missing.status, missing.body.error]).toMatchObject([
      404,
      { code: "version_not_found" },
    ]);
  });

  it("outranks the built-in guard; two company guards on a key are ambiguous, each runnable by its id; removing one ends it", async () => {
    await write("fixture", fixtureFiles());
    await write("second", guardWorkflow("second", "proposal.approve", "second_says_no"));
    const n = await readyProposal();
    const amb = await a.run("proposal.approve", `proposal:${n}`, {}, DEV);
    expect([amb.status, amb.body.error]).toMatchObject([
      409,
      {
        code: "action_ambiguous",
        contributions: [
          {
            contribution: "fixture.approve-guard",
            cli: "penguin org action exec fixture.approve-guard",
          },
          { contribution: "second.guard", cli: "penguin org action exec second.guard" },
        ],
      },
    ]);
    // The built-in Action's own id still resolves the guard by key: the same answer.
    const byAction = await a.run(
      "by-id/company-proposals.action.approve",
      `proposal:${n}`,
      {},
      DEV,
    );
    expect([byAction.status, byAction.body.error]).toMatchObject([
      409,
      { code: "action_ambiguous" },
    ]);
    // Neither ambiguity is a run.
    expect((await a.get(`/runs?subject=proposal:${n}&key=proposal.approve`)).body.runs).toEqual([]);
    // Named by its id, one guard judges alone.
    const second = await a.run("by-id/second.guard", `proposal:${n}`, {}, DEV);
    expect([second.status, second.body.error]).toMatchObject([403, { code: "second_says_no" }]);
    const fixture = await a.run("by-id/fixture.approve-guard", `proposal:${n}`, {}, DEV);
    expect(fixture.status).toBe(200);
    expect(fixture.body.run).toMatchObject({
      key: "proposal.approve",
      contribution: "company-proposals.action.approve",
      outcome: "succeeded",
    });
    expect((await a.get("/check")).body.conflicts).toEqual([
      {
        key: "proposal.approve",
        kind: "guard",
        contributions: ["fixture.approve-guard", "second.guard"],
      },
    ]);
    expect((await a.run("workflow.remove", "workflow:second")).status).toBe(200);
    // One company guard is left on the key: it decides, and the proposal is approved already.
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, DEV)).body).toMatchObject({
      error: { code: "proposal_status" },
    });
  });

  it("cannot replace or hook the workflow.* Actions: such a contribution is left out, and the write says so", async () => {
    const written = await write("lock", guardWorkflow("lock", "workflow.write", "locked_out"));
    // The run's result lists it as the read does, and not among the contributions in force.
    expect(written.body.result).toMatchObject({
      loaded: true,
      workflow: {
        contributions: [],
        skipped: [{ id: "lock.guard", reason: expect.stringContaining("workflow.*") }],
      },
    });
    const reloaded = await a.run("workflow.reload", "workflow:lock");
    expect(reloaded.body.result).toMatchObject({
      workflow: { contributions: [], skipped: [{ id: "lock.guard" }] },
    });
    const shown = await a.app.request(`/p/${PROJECT}/o/${ORG}/workflows/lock`, {
      headers: { "x-user": "boss" },
    });
    expect(await shown.json()).toMatchObject({
      contributions: [],
      skipped: [{ id: "lock.guard", reason: expect.stringContaining("workflow.*") }],
    });
    expect((await write("fixture", fixtureFiles())).status).toBe(200);
  });

  it("is loaded again by the registry of a hot update; a run the old registry started ends there", async () => {
    await write("fixture", fixtureFiles());
    // A slow process of the old registry's own, in flight across the update. Real clocks here:
    // the new registry's store must see the run as this process's, not a past one's.
    const slow: Contributed = {
      id: "test.slow",
      from: "CompanyProposalsPlugin",
      data: { kind: "action", key: "test.slow", subjects: ["organization"] },
      code: {
        run: (ctx: { process(argv: string[]): Promise<unknown> }) =>
          ctx.process([process.execPath, "-e", "setTimeout(() => console.log('done'), 300)"]),
      },
    };
    const old = app(workflows, [slow], Date.now);
    const started = await old.run("test.slow", "organization");
    expect(started.status).toBe(202);
    old.registry.stop();
    workflows.stop();
    // The new App: a registry and the organization's workflows, both built anew from disk.
    const again = new CompanyWorkflows({
      loader: await realLoader(),
      root: org.root,
      log: (line) => logs.push(line),
    });
    const next = app(again, [], Date.now);
    expect(next.registry).not.toBe(old.registry);
    expect(next.registry).toBeInstanceOf(ActionRegistry);
    const n = await readyProposal();
    expect((await next.run("proposal.approve", `proposal:${n}`, {}, QA)).status).toBe(403);
    const end = await settled(next, (started.body.run as { id: string }).id);
    expect(end.run).toMatchObject({ outcome: "succeeded" });
    expect(end.output).toContain("done");
    next.registry.stop();
    again.stop();
  });
});
