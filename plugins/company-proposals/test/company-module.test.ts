/**
 * A company module (test-fixtures/company-module) built and loaded the way one is: a deploy
 * Action, a guard replacing proposal.approve's and an after hook on it. None of it counts until
 * the organization binds it; bound, the guard decides and the hook follows. The deploy runs on
 * the commit its subject resolves to, refuses one that moved, and keeps the process's output. A
 * hot update builds the registry anew from what is contributed then, while a run the old one
 * started ends there.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry, BUILTIN_MODULES, type Contributed } from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";
import {
  actionApp,
  manifestContributions,
  proposalContributions,
  type ActionApp,
} from "./action-harness.js";
import { FIXTURE_DIR, buildFixture, type FixtureExports } from "./company-fixture.js";
import { BOSS, DEV, DOC, ORG, PROJECT, QA, fakeOrg } from "./fake-org.js";

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

let fixture: FixtureExports;

beforeAll(async () => {
  fixture = await buildFixture();
}, 60_000);

function fixtureContributions(): Contributed[] {
  return manifestContributions(FIXTURE_DIR, "FixtureCompanyModule", {
    "fixture.deploy": fixture.deployCode,
    "fixture.approve-guard": fixture.approveGuard,
    "fixture.approve-hook": fixture.approveHook,
  });
}

/** Follows a run until it ends. */
async function settled(
  a: ActionApp,
  id: string,
): Promise<{ run: Record<string, unknown>; output: string }> {
  for (let i = 0; i < 200; i++) {
    const got = await a.get(`/runs/${id}`);
    const run = got.body.run as Record<string, unknown>;
    if (run.outcome !== null) return { run, output: got.body.output as string };
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${id} did not end`);
}

describe("a company module", () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let a: ActionApp;

  beforeEach(async () => {
    org = await fakeOrg({ gh });
    fixture.followed.length = 0;
    a = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      service: org.service,
      contributions: [...proposalContributions(org.service), ...fixtureContributions()],
    });
  });
  afterEach(async () => {
    a.registry.stop();
    await org.cleanup();
  });

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

  it("counts for nothing until bound: its guard does not apply, its hook does not run, its deploy is not there", async () => {
    const n = await readyProposal();
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, QA)).status).toBe(200);
    expect(fixture.followed).toEqual([]);
    expect((await a.run("deploy.fixture", "pr:owner/repo#5")).status).toBe(404);
    const listed = (await a.get("/contributions")).body.contributions as Array<{
      id: string;
      enabled: boolean;
    }>;
    expect(listed.filter((c) => c.id.startsWith("fixture.")).map((c) => c.enabled)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("bound, its guard replaces approve's and its after hook follows each approval", async () => {
    for (const id of ["fixture.approve-guard", "fixture.approve-hook"]) {
      expect(
        (await a.run("action.bind", "organization", { contribution: id, enabled: true }, BOSS))
          .status,
      ).toBe(200);
    }
    const n = await readyProposal();
    const refused = await a.run("proposal.approve", `proposal:${n}`, {}, QA);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: { code: "qa_does_not_approve" } });
    // The replacement wraps the default: the proposal's own rules still hold for others.
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, DEV)).status).toBe(200);
    expect((await a.run("proposal.approve", `proposal:${n}`, {}, DEV)).body).toMatchObject({
      error: { code: "proposal_status" },
    });
    expect(fixture.followed).toEqual([
      { key: "proposal.approve", outcome: "succeeded", by: "agent:acme_dev" },
    ]);
    const runs = (await a.get(`/runs?subject=proposal:${n}&key=proposal.approve`)).body
      .runs as Array<{ outcome: string; by: string }>;
    expect(runs.map((r) => [r.outcome, r.by])).toEqual([
      ["refused", "agent:acme_dev"],
      ["succeeded", "agent:acme_dev"],
      ["refused", "agent:acme_qa"],
    ]);
  });

  it("bound, its deploy runs on the subject's commit, refuses a head that moved, and keeps the output", async () => {
    await a.run("action.bind", "organization", { contribution: "fixture.deploy", enabled: true });
    const listed = (await a.get("/?subject=pr:owner/repo%235")).body.actions as Array<{
      key: string;
      allowed: boolean;
    }>;
    expect(listed.find((x) => x.key === "deploy.fixture")?.allowed).toBe(true);
    const moved = await a.run("deploy.fixture", "pr:owner/repo#5", { expectedHead: "bbbbbbbb" });
    expect(moved.status).toBe(409);
    expect(moved.body).toMatchObject({ error: { code: "head_moved" } });
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

  it("a hot update indexes what is contributed then; a run the old registry started ends there", async () => {
    await a.run("action.bind", "organization", { contribution: "fixture.deploy", enabled: true });
    // A slow process of the old registry's own, to be in flight across the update. Real clocks
    // here: the new registry's store must see the run as this process's, not a past one's.
    const slow: Contributed = {
      id: "test.slow",
      from: "CompanyProposalsPlugin",
      data: { kind: "action", key: "test.slow", subjects: ["organization"] },
      code: {
        run: (ctx: { process(argv: string[]): Promise<unknown> }) =>
          ctx.process([process.execPath, "-e", "setTimeout(() => console.log('done'), 300)"]),
      },
    };
    const old = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      contributions: [...proposalContributions(org.service), ...fixtureContributions(), slow],
      deps: { now: Date.now },
    });
    const started = await old.run("test.slow", "organization");
    expect(started.status).toBe(202);
    old.registry.stop();
    // The new App's registry: the company module is gone from the tree.
    const next = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      contributions: proposalContributions(org.service),
      deps: { now: Date.now },
    });
    expect(next.registry).not.toBe(old.registry);
    expect(next.registry).toBeInstanceOf(ActionRegistry);
    expect((await next.run("deploy.fixture", "pr:owner/repo#5")).status).toBe(404);
    const end = await settled(next, (started.body.run as { id: string }).id);
    expect(end.run).toMatchObject({ outcome: "succeeded" });
    expect(end.output).toContain("done");
    next.registry.stop();
    expect(BUILTIN_MODULES.has("FixtureCompanyModule")).toBe(false);
  });
});
