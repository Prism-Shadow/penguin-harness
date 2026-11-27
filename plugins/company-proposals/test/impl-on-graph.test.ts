/**
 * The impl registration's graph rules through the Action route (`proposal.impl`): a base the
 * graph draws is taken — the base branch, another proposal's impl head, an open PR's head as the
 * last graph read has it — and any other is a 400 `base_not_on_graph`; before any graph read the
 * answer says the open PRs were not consulted; a merged PR whose head branch another proposal
 * still stacks on is a 409 `base_in_use`. Nothing registered is rewritten by a refusal.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import { ProposalService } from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";
import { FakeOrgGateway, BOSS, DEV, ORG, PROJECT } from "./fake-org.js";
import { FakeForge, FakeMirror, cr, rel } from "./graph-fakes.js";
import { actionApp, proposalContributions, type ActionApp } from "./action-harness.js";

const sha = (c: string): string => c.repeat(40);
const D = sha("0");
const OPEN = sha("1");
/** Merged PRs from origin's feat/a into dev: GitHub says so for 20, its answer for 21 does not. */
const MERGED_URL = "https://github.com/acme/site/pull/20";
const CACHED_URL = "https://github.com/acme/site/pull/21";

const gh: RunGh = async (args) => {
  const sides = {
    head_repo: "acme/site",
    head: "feat/a",
    sha: sha("a"),
    base_repo: "acme/site",
    base: "dev",
  };
  if (args[1] === "repos/acme/site/pulls/20") return JSON.stringify({ ...sides, merged: true });
  if (args[1] === "repos/acme/site/pulls/21") return JSON.stringify(sides);
  throw new Error(`HTTP 404: ${args[1]}`);
};

describe("proposal.impl keeps the impl on the PR graph", () => {
  let root: string;
  let service: ProposalService;
  let app: ActionApp;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "impl-on-graph-"));
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    const gateway = new FakeOrgGateway(workspace);
    // One open PR on dev from feat/open; PR 20 from feat/a is merged.
    const forge = new FakeForge([
      cr("acme/site", 11, { head: OPEN, branch: "feat/open" }),
      cr("acme/site", 20, { head: sha("a"), branch: "feat/a", state: "merged" }),
      cr("acme/site", 21, { head: sha("a"), branch: "feat/a", state: "merged" }),
    ]);
    const mirror = new FakeMirror(
      new Map([
        ["refs/heads/dev", D],
        ["refs/pull/11/head", OPEN],
      ]),
      "dev",
      new Map([[`${D}...${OPEN}`, rel("ahead", 1, 0, D)]]),
    );
    service = new ProposalService({
      gateway,
      agents: {
        pluginVersion: async () => ({ installed: null, library: null }),
        updatePlugin: async () => undefined,
        removeSkill: async () => undefined,
      },
      root,
      log: { line: () => undefined },
      forge,
      mirrorFor: () => mirror,
      gh,
      git: async () =>
        [
          "origin\thttps://github.com/acme/site.git (fetch)",
          "fork\tgit@github.com:me/site.git (fetch)",
        ].join("\n"),
      pluginConfig: { get: () => ({ deliveryRepo: "acme/site", deliveryBase: "dev" }) },
    });
    app = actionApp({
      gateway,
      root,
      project: PROJECT,
      org: ORG,
      contributions: proposalContributions(service),
      service,
    });
  });
  afterEach(async () => {
    app.registry.stop();
    await service.graphSettled(PROJECT, ORG);
    service.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function proposal(): Promise<number> {
    return (await service.create(PROJECT, ORG, { author: "acme_dev", brief: "B" }, BOSS)).number;
  }
  const branch = (name: string) => ({ remote: "origin", branch: name });
  async function impl(n: number, params: Record<string, unknown>, actor: OrgActor = DEV) {
    const { status, body } = await app.run("proposal.impl", `proposal:${n}`, params, actor);
    const result = (status === 200 ? body.result : body) as {
      hints?: string[];
      error?: { code: string; message: string };
    };
    return {
      status,
      hints: result.hints,
      code: result.error?.code,
      message: result.error?.message,
    };
  }

  it("before any graph read, judges by the base branch and the impl heads, and says so", async () => {
    // The open PR's head is not known without a graph: refused (a refusal reads no graph).
    const unknown = await impl(await proposal(), {
      head: branch("feat/c"),
      base: branch("feat/open"),
    });
    expect(unknown).toMatchObject({ status: 400, code: "base_not_on_graph" });
    expect(unknown.message).toContain("open a PR for it");
    const set = await impl(await proposal(), { head: branch("feat/a"), base: branch("dev") });
    expect(set.status).toBe(200);
    expect(set.hints).toEqual([expect.stringContaining("not checked against the open PRs")]);
  });

  it("takes the three kinds of base the graph draws, refuses any other, and a merged PR others stack on", async () => {
    const read = await service.graph(PROJECT, ORG, BOSS, { refresh: true });
    expect(read.nodes.map((n) => n.branch)).toEqual(["feat/open"]);
    const first = await proposal();
    const second = await proposal();
    const third = await proposal();

    const onBase = await impl(first, { head: branch("feat/a"), base: branch("dev") });
    expect(onBase).toMatchObject({ status: 200, hints: undefined });
    expect((await impl(second, { head: branch("feat/b"), base: branch("feat/a") })).status).toBe(
      200,
    );
    expect((await impl(third, { head: branch("feat/c"), base: branch("feat/open") })).status).toBe(
      200,
    );
    const gone = await impl(await proposal(), {
      head: branch("feat/d"),
      base: branch("nowhere"),
    });
    expect(gone).toMatchObject({ status: 400, code: "base_not_on_graph" });
    expect(gone.message).toContain("accepted when it is dev");

    // GitHub's answer for PR 21 does not say merged; the status the proposal page read does.
    await service.addMaterial(PROJECT, ORG, first, { kind: "pr", url: CACHED_URL }, DEV);
    await service.get(PROJECT, ORG, first, BOSS);
    await service.prStatusSettled(PROJECT, ORG, first);
    const merged = await impl(first, { url: CACHED_URL });
    expect(merged).toMatchObject({ status: 409, code: "base_in_use" });
    expect(merged.message).toContain(`#${second}`);
    // Nothing was rewritten: the impl stands as registered.
    expect((await service.get(PROJECT, ORG, first, BOSS)).impl).toMatchObject({
      head: branch("feat/a"),
      base: branch("dev"),
      pr: null,
    });
  });

  it("refuses a merged PR attached fresh, nothing cached, whose head another proposal stacks on", async () => {
    const first = await proposal();
    const second = await proposal();
    expect((await impl(first, { head: branch("feat/a"), base: branch("dev") })).status).toBe(200);
    expect((await impl(second, { head: branch("feat/b"), base: branch("feat/a") })).status).toBe(
      200,
    );
    // No pr_status row and no stored PR: GitHub's answer to the write's own read decides.
    const merged = await impl(first, { url: MERGED_URL });
    expect(merged).toMatchObject({ status: 409, code: "base_in_use" });
    expect(merged.message).toContain(`#${second}`);
  });
});
