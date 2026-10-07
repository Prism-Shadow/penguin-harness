/**
 * The service over a fake organization gateway: the whole lifecycle of a proposal — a
 * person delegates, the author publishes and marks ready, comments gather and go out as
 * one batch, the author resolves, an implementer's session opens, feedback, approval,
 * merge — every drive of an employee being one `[proposal #<n>]` line on its desk, in
 * nobody's name and never to the employee that acted, every refusal the right one, pending
 * comments their writer's alone, a person and an employee allowed alike (the default guards),
 * unread counts moving with each reader's position, the writes through the Action routes where a
 * route is exercised, and the whole thing standing again
 * when a new service opens the same store. Nothing here starts a server or a Session.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import plugin, {
  sectionSource,
  CompanyActionRegistry,
  CompanyProposalsPlugin,
  ProposalNotices,
  ProposalsRetirement,
  RETIRE_ID,
  ACTION_ROUTES_ID,
  PAGE_ID,
  ProposalError,
  ProposalService,
  type ServiceDeps,
  ROUTES_ID,
  CONFIG_GROUP,
  DEFAULT_TEST_GROUPS,
  TEST_GROUP_LINE,
  SqliteProposalStore,
  companyDbPath,
  slugOf,
  testGroupsOf,
} from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";
import { FakeForge, FakeMirror, cr, rel } from "./graph-fakes.js";
import { withImplPr } from "../src/service.js";
import { actionApp, proposalContributions, type ActionApp } from "./action-harness.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "proj";
const ORG = "acme";
const BOSS: OrgActor = { userId: "boss" };
const OUTSIDER: OrgActor = { userId: "stranger" };
const author: OrgActor = { userId: "boss", agentId: "acme_dev", sessionId: "desk-dev" };
const impl: OrgActor = { userId: "boss", agentId: "acme_impl", sessionId: "desk-impl" };
const qa: OrgActor = { userId: "boss", agentId: "acme_qa", sessionId: "desk-qa" };

const DOC = `---
title: Batch the ticket notices
scope:
  - file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket"
---

## Change

\`notifyTicket\` writes \`org_desk_notices\` instead of messaging the desk.

\`reconcileCalendar\` appends the digest before a sweep.

## Purpose

One sweep handles every change.

## Test

"a blocked ticket reaches its owner at the next sweep, once".
`;

class FakeGateway implements OrgGateway {
  enabled = true;
  org: OrgView | null = {
    projectId: PROJECT,
    orgId: ORG,
    name: "Acme",
    status: "active",
    language: "en",
    workspace: "/tmp/acme",
    employees: [
      { agentId: "acme_ceo", name: "CEO", title: "CEO", reportsTo: null },
      { agentId: "acme_dev", name: "Dev", title: "Engineer", reportsTo: "acme_ceo" },
      { agentId: "acme_impl", name: "Impl", title: "Engineer", reportsTo: "acme_ceo" },
      { agentId: "acme_qa", name: "QA", title: "Tester", reportsTo: "acme_ceo" },
    ],
    userIds: ["boss"],
    machineId: null,
  };
  /** Every line put on a desk, in order. */
  desks: Array<{ agentId: string; text: string }> = [];
  sessions: Array<{ agentId: string; title: string; body: string; workspace?: string }> = [];
  events: ServerEvent[] = [];
  /** Desks that refuse a line, with the reason (a paused employee, say). */
  refuse = new Map<string, string>();
  /** The code a refusal carries, as the organization service's HttpError does (409 `employee_paused`, say). */
  refuseCodes = new Map<string, string>();

  companyModeEnabled(): boolean {
    return this.enabled;
  }
  async organization(): Promise<OrgView | null> {
    return this.org;
  }
  async principalOf(_p: string, _o: string, actor: OrgActor): Promise<string> {
    if (
      actor.agentId !== undefined &&
      this.org?.employees.some((e) => e.agentId === actor.agentId)
    ) {
      return `agent:${actor.agentId}`;
    }
    return `user:${actor.userId}`;
  }
  async deliverToDesk(_p: string, _o: string, agentId: string, text: string) {
    const refused = this.refuse.get(agentId);
    if (refused !== undefined) {
      const code = this.refuseCodes.get(agentId);
      throw code === undefined
        ? new Error(refused)
        : Object.assign(new Error(refused), { status: 409, code });
    }
    this.desks.push({ agentId, text });
    return { sessionId: `desk-${agentId}`, queued: false };
  }
  async openEmployeeSession(args: {
    agentId: string;
    title: string;
    body: string;
    workspace?: string;
  }) {
    this.sessions.push(args);
    return {
      sessionId: `impl-${this.sessions.length}`,
      workspace: args.workspace ?? "/tmp/acme/impl",
    };
  }
  notifyProject(_projectId: string, event: ServerEvent): void {
    this.events.push(event);
  }
  // Proposals open no room; the gateway's room is company-roadmaps'.
  async openRoom(args: { channelId: string }) {
    return { channelId: args.channelId };
  }
  async changeRoomMembers() {
    return { added: [], removed: [] };
  }
}

/** The Agent lifecycle as the service uses it: which employees carry the skills plugin, and the installs it asked for. */
class FakeAgents {
  /** The plugin's version in the library; null = the library does not carry it. */
  library: string | null = "2026.09.21.1";
  installed = new Set<string>();
  /** Employees whose installed copy is older than the library's. */
  outdated = new Set<string>();
  updates: string[] = [];
  failInstall = false;
  async pluginVersion(_p: string, agentId: string, _name: string) {
    const installed = !this.installed.has(agentId)
      ? null
      : this.outdated.has(agentId)
        ? "2026.09.01.1"
        : this.library;
    return { installed, library: this.library };
  }
  async updatePlugin(_p: string, agentId: string, _name: string): Promise<void> {
    if (this.failInstall) throw new Error("library unreadable");
    this.updates.push(agentId);
    this.installed.add(agentId);
    this.outdated.delete(agentId);
  }
  /** Skills each employee carries apart from the plugin's own, by name; a removal takes one off. */
  others = new Map<string, Set<string>>();
  removed: string[] = [];
  async removeSkill(_p: string, agentId: string, name: string): Promise<void> {
    if (this.others.get(agentId)?.delete(name) === true) this.removed.push(`${agentId}/${name}`);
  }
}

/** `gh` as the service sees it: every pull request asked about is merged; the arguments asked are recorded. */
const githubCalls: string[][] = [];
const githubGh: RunGh = async (args) => {
  githubCalls.push([...args]);
  return JSON.stringify({ state: "closed", merged: true, merged_at: "2026-09-23T00:00:00Z" });
};

/** The graph's ports with nothing behind them: no test here reaches GitHub or a remote. */
function offline(): { forge: FakeForge; mirrorFor: () => FakeMirror } {
  const mirror = new FakeMirror();
  return { forge: new FakeForge(), mirrorFor: () => mirror };
}

/** What the organization's store holds, read through a connection of the test's own. */
function storeOf<T>(root: string, read: (store: SqliteProposalStore) => T): T {
  const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
  try {
    return read(store);
  } finally {
    store.close();
  }
}

async function refused(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (err) {
    if (err instanceof ProposalError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("ProposalService", () => {
  let root: string;
  let gateway: FakeGateway;
  let agents: FakeAgents;
  let service: ProposalService;
  const lines: string[] = [];
  const log = { line: (l: string) => lines.push(l) };

  /** Every service the tests opened: closed, so their store connections release company.db. */
  const services: ProposalService[] = [];
  const newService = (deps: ServiceDeps): ProposalService => {
    const s = new ProposalService(deps);
    services.push(s);
    return s;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-service-"));
    gateway = new FakeGateway();
    // The shared workspace the scope is checked against: the file DOC's scope names exists.
    const workspace = path.join(root, "workspace");
    await fs.mkdir(path.join(workspace, "packages/server/src/runtime/organization"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspace, "packages/server/src/runtime/organization/reconcile.ts"),
      "export {};\n",
    );
    gateway.org!.workspace = workspace;
    agents = new FakeAgents();
    lines.length = 0;
    githubCalls.length = 0;
    service = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      gh: githubGh,
    });
  });
  /** The registries the tests opened: stopped, so their store connections close. */
  const harnesses: ActionApp[] = [];
  afterEach(async () => {
    for (const h of harnesses.splice(0)) h.registry.stop();
    for (const s of services.splice(0)) s.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * The routes over the current service: the reads (`call`), and every write as the Action it
   * is (`run`), answering like a route does — the Action's result, or the refusal's body.
   */
  function routes(): {
    call: (method: string, suffix: string) => Promise<Response>;
    run: (
      key: string,
      subject: string,
      params?: Record<string, unknown>,
      actor?: OrgActor,
    ) => Promise<{ status: number; json: () => Promise<unknown> }>;
  } {
    const h = actionApp({
      gateway,
      root,
      project: PROJECT,
      org: ORG,
      contributions: proposalContributions(service),
      service,
    });
    harnesses.push(h);
    return {
      call: async (method, suffix) =>
        h.app.request(`/p/${PROJECT}/o/${ORG}/proposals${suffix}`, { method }),
      run: async (key, subject, params = {}, actor = BOSS) => {
        const { status, body } = await h.run(key, subject, params, actor);
        return { status, json: async () => (status === 200 ? body.result : body) };
      },
    };
  }

  async function delegated(): Promise<number> {
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_dev", brief: "Batch the notices" },
      BOSS,
    );
    return created.number;
  }

  it("registers one impl PR per proposal through the routes, refuses a taken PR, and the graph carries the proposal", async () => {
    const A = "a".repeat(40);
    const D = "0".repeat(40);
    // The repository as the forge and the mirror answer it: one open PR on dev, two commits ahead.
    const forge = new FakeForge([cr("acme/site", 11, { head: A, branch: "feat/a" })]);
    const mirror = new FakeMirror(
      new Map([
        ["refs/heads/dev", D],
        ["refs/heads/main", D],
        ["refs/pull/11/head", A],
      ]),
      "main",
      new Map([[`${D}...${A}`, rel("ahead", 2, 0, D)]]),
    );
    let values: Record<string, unknown> = {};
    let remotes = "";
    const gitCalls: string[][] = [];
    service = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      gh: githubGh,
      forge,
      mirrorFor: () => mirror,
      git: async (cwd, args) => {
        gitCalls.push([cwd, ...args]);
        return remotes;
      },
      pluginConfig: { get: () => values },
    });
    const first = await delegated();
    const second = await delegated();
    const { call, run } = routes();
    const url = "https://github.com/acme/site/pull/11";

    const set = await run("proposal.impl", `proposal:${first}`, { url }, author);
    expect(set.status).toBe(200);
    expect(((await set.json()) as { implPr: unknown }).implPr).toMatchObject({
      url,
      label: "acme/site#11",
      by: "agent:acme_dev",
    });
    const taken = await run("proposal.impl", `proposal:${second}`, { url }, author);
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe("impl_pr_taken");
    // Any employee registers one, not only the author or the implementer; the line says who.
    expect(
      (await run("proposal.impl", `proposal:${second}`, { url }, qa)).status,
      "a taken PR stays taken whoever asks",
    ).toBe(409);
    const third = await delegated();
    const byQa = await run(
      "proposal.impl",
      `proposal:${third}`,
      { url: "https://github.com/acme/site/pull/12" },
      qa,
    );
    expect(byQa.status).toBe(200);
    expect(((await byQa.json()) as { implPr: unknown }).implPr).toMatchObject({
      by: "agent:acme_qa",
    });
    expect(
      (await run("proposal.impl", `proposal:${second}`, { url: "https://example.com/x" }, author))
        .status,
    ).toBe(400);

    type Graph = {
      repo: string;
      base: { branch: string };
      origins: Array<{ name: string; repo: string }>;
      nodes: Array<{ number: number; proposal: { number: number } | null }>;
      errors: string[];
    };
    // With nothing set and no GitHub remote in the workspace, the graph is the base branch alone.
    // The impl registrations above refreshed the graph, and the refresher read the workspace's
    // remotes (`git remote -v`, the only git it runs with no delivery repository); the read
    // answers what it found and runs none itself.
    await service.graphSettled(PROJECT, ORG);
    const gitBefore = gitCalls.length;
    const bare = await call("GET", "/graph");
    expect(bare.status).toBe(200);
    const alone = (await bare.json()) as Graph;
    expect(alone).toMatchObject({ repo: "", base: { branch: "dev" }, nodes: [] });
    expect(alone.errors[0]).toContain("no delivery repository");
    expect(gitCalls.length).toBe(gitBefore);
    expect(gitBefore).toBeGreaterThan(0);
    for (const c of gitCalls)
      expect(c).toEqual([expect.stringMatching(/workspace$/), "remote", "-v"]);

    // Nothing set: the workspace remote holding the impl PR wins over `origin`, on the repository's
    // default branch while the stack base is empty, and the other remote annotates the graph.
    remotes = [
      "origin\thttps://github.com/up/site.git (fetch)",
      "mine\tgit@github.com:acme/site.git (fetch)",
    ].join("\n");
    values = { deliveryBase: "" };
    // The refresh button: the server reads the repository before it answers.
    const fallback = (await (await call("GET", "/graph?refresh=1")).json()) as Graph;
    expect(fallback.repo).toBe("acme/site");
    expect(fallback.base.branch).toBe("main");
    expect(fallback.origins).toEqual([{ name: "origin", repo: "up/site" }]);
    expect(fallback.nodes.map((n) => [n.number, n.proposal?.number])).toEqual([[11, first]]);
    // A declared stack base is kept.
    values = { deliveryBase: "dev" };
    expect(((await (await call("GET", "/graph?refresh=1")).json()) as Graph).base.branch).toBe(
      "dev",
    );

    // A set delivery repository is read as it is, without the workspace.
    remotes = "";
    values = { deliveryRepo: "acme/site" };
    const graph = (await (await call("GET", "/graph?refresh=1")).json()) as {
      nodes: Array<{ number: number; proposal: { number: number } | null }>;
      top: string | null;
    };
    expect(graph.nodes.map((n) => [n.number, n.proposal?.number])).toEqual([[11, first]]);
    expect(graph.top).toBe("feat/a");

    // The one-time adoption: the latest pr material on the delivery repository, by anybody in the
    // organization — here an employee, recorded as it.
    for (const u of [
      "https://github.com/acme/site/pull/20",
      "https://github.com/up/site/pull/900",
      "https://github.com/acme/site/pull/21",
    ]) {
      await service.addMaterial(PROJECT, ORG, second, { kind: "pr", url: u }, author);
    }
    const adoptedByAgent = await run("proposal.impl.adopt", "organization", {}, author);
    expect(adoptedByAgent.status).toBe(200);
    const adopted = (await adoptedByAgent.json()) as Awaited<ReturnType<typeof service.adoptImpl>>;
    expect(adopted.adopted).toEqual([
      { number: second, url: "https://github.com/acme/site/pull/21" },
    ]);
    expect(adopted.ambiguous).toEqual([
      {
        number: second,
        urls: ["https://github.com/acme/site/pull/20", "https://github.com/acme/site/pull/21"],
      },
    ]);
    expect(adopted.skipped).toEqual([]);
    expect((await service.get(PROJECT, ORG, second, BOSS)).implPr).toMatchObject({
      label: "acme/site#21",
      by: "agent:acme_dev",
    });
    // Run again, nothing is left to adopt.
    expect((await service.adoptImpl(PROJECT, ORG, BOSS)).adopted).toEqual([]);
  });

  it("registers an impl branch through the routes, attaches the PR opened for its head, and answers its patch", async () => {
    const pulls: Record<string, unknown> = {
      "repos/acme/site/pulls/9": {
        head_repo: "me/site",
        head: "feat/x",
        sha: "a".repeat(40),
        base_repo: "acme/site",
        base: "dev",
      },
      "repos/acme/site/pulls/10": {
        head_repo: "acme/site",
        head: "other",
        sha: "b".repeat(40),
        base_repo: "acme/site",
        base: "dev",
      },
      "repos/me/site/branches/feat/x": "a".repeat(40),
      "repos/acme/site/branches/other": "b".repeat(40),
      "repos/acme/site/compare/dev...other": {
        merge_base: "c".repeat(40),
        ahead: 1,
        behind: 0,
        files: [],
      },
      "repos/acme/site/compare/dev...me:feat/x": {
        merge_base: "c".repeat(40),
        ahead: 1,
        behind: 0,
        url: "https://github.com/acme/site/compare/dev...me:feat/x",
        files: [{ filename: "a.ts", status: "added", additions: 2, deletions: 0, patch: "@@" }],
      },
    };
    const gh: RunGh = async (args) => {
      const p = args[1]!;
      if (p in pulls) return JSON.stringify(pulls[p]);
      throw new Error(`HTTP 404: ${p}`);
    };
    service = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      gh,
      // The graph stacks on main: the impl bases below are on it (impl-on-graph.ts).
      pluginConfig: { get: () => ({ deliveryBase: "main" }) },
      git: async () =>
        [
          "origin\thttps://github.com/acme/site.git (fetch)",
          "fork\tgit@github.com:me/site.git (fetch)",
        ].join("\n"),
    });
    const first = await delegated();
    const second = await delegated();
    const { call, run } = routes();
    const codeOf = async (res: { json: () => Promise<unknown> }) =>
      ((await res.json()) as { error: { code: string } }).error.code;
    const impl = (n: number, params: Record<string, unknown>, actor: OrgActor = author) =>
      run("proposal.impl", `proposal:${n}`, params, actor);
    const head = { remote: "fork", branch: "feat/x" };
    const base = { remote: "origin", branch: "main" };

    // No impl yet: no patch.
    const none = await call("GET", `/${first}/impl/diff`);
    expect(none.status).toBe(409);
    expect(await codeOf(none)).toBe("no_impl");

    // Head and base go together, and each remote must name a GitHub repository.
    expect((await impl(first, { head })).status).toBe(400);
    const unknown = await impl(first, { head: { remote: "nowhere", branch: "feat/x" }, base });
    expect(unknown.status).toBe(400);
    expect(await codeOf(unknown)).toBe("impl_remote_unknown");
    expect(
      (await impl(first, { head: { remote: "origin", branch: "a b" }, base }, BOSS)).status,
    ).toBe(400);

    // The branch pair alone: no PR needed.
    const set = await impl(first, { head, base });
    expect(set.status).toBe(200);
    const detail = (await set.json()) as { impl: unknown; implPr: unknown };
    expect(detail.impl).toMatchObject({ head, base, pr: null, by: "agent:acme_dev" });
    expect(detail.implPr).toBeNull();
    expect((await service.get(PROJECT, ORG, first, BOSS)).impl).toMatchObject({ head, base });

    // The same head for a second proposal is taken.
    const taken = await impl(second, { head, base }, qa);
    expect(taken.status).toBe(409);
    expect(await codeOf(taken)).toBe("impl_branch_taken");

    // A PR whose head is another branch does not attach.
    const mismatch = await impl(first, { url: "https://github.com/acme/site/pull/10" });
    expect(mismatch.status).toBe(409);
    expect(await codeOf(mismatch)).toBe("impl_pr_mismatch");

    // The PR opened from the head attaches, and its base replaces the declared one.
    const attached = await impl(first, { url: "https://github.com/acme/site/pull/9" });
    expect(attached.status).toBe(200);
    const withPr = (await attached.json()) as { impl: unknown; implPr: unknown };
    expect(withPr.impl).toMatchObject({
      head,
      base: { remote: "origin", branch: "dev" },
      pr: "https://github.com/acme/site/pull/9",
    });
    expect(withPr.implPr).toMatchObject({ label: "acme/site#9" });

    // The patch: the merge base of base and head, up to head.
    const diff = await call("GET", `/${first}/impl/diff`);
    expect(diff.status).toBe(200);
    expect(await diff.json()).toMatchObject({
      head: { remote: "fork", repo: "me/site", branch: "feat/x" },
      base: { remote: "origin", repo: "acme/site", branch: "dev" },
      headSha: "a".repeat(40),
      mergeBase: "c".repeat(40),
      files: [{ path: "a.ts", additions: 2 }],
      pr: "https://github.com/acme/site/pull/9",
    });

    // A PR registered alone (as every impl line written before impl branches is) has its head and
    // base read off the PR; declaring that same head later keeps the PR.
    await service.setImpl(
      PROJECT,
      ORG,
      second,
      { url: "https://github.com/acme/site/pull/10" },
      author,
    );
    const fromPr = (await (await call("GET", `/${second}/impl/diff`)).json()) as {
      head: unknown;
      base: unknown;
    };
    expect(fromPr.head).toEqual({ remote: null, repo: "acme/site", branch: "other" });
    expect(fromPr.base).toEqual({ remote: null, repo: "acme/site", branch: "dev" });
    const declared = await service.setImpl(
      PROJECT,
      ORG,
      second,
      { head: { remote: "origin", branch: "other" }, base: { remote: "origin", branch: "main" } },
      author,
    );
    expect(declared.impl).toMatchObject({
      head: { remote: "origin", branch: "other" },
      pr: "https://github.com/acme/site/pull/10",
    });
    // A different head drops the PR.
    const moved = await service.setImpl(
      PROJECT,
      ORG,
      second,
      { head: { remote: "origin", branch: "moved" }, base: { remote: "origin", branch: "main" } },
      author,
    );
    expect(moved.impl).toMatchObject({ pr: null });
    expect(moved.implPr).toBeNull();
  });

  it("answers 404 while company mode is off or the organization is missing, 403 to an outsider", async () => {
    gateway.enabled = false;
    expect(await refused(() => service.list(PROJECT, ORG, BOSS))).toEqual({
      status: 404,
      code: "company_mode_off",
    });
    gateway.enabled = true;
    gateway.org = null;
    expect(await refused(() => service.list(PROJECT, ORG, BOSS))).toEqual({
      status: 404,
      code: "org_not_found",
    });
    gateway = new FakeGateway();
    githubCalls.length = 0;
    service = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      gh: githubGh,
    });
    expect(await refused(() => service.list(PROJECT, ORG, OUTSIDER))).toEqual({
      status: 403,
      code: "project_access",
    });
  });

  it("a person delegates: the proposal is numbered and the author's desk gets one line, in nobody's name", async () => {
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_dev", brief: "Batch the notices\nsecond line" },
      BOSS,
    );
    expect(created).toMatchObject({
      number: 1,
      title: "Batch the notices",
      status: "drafting",
      revision: 0,
      author: "acme_dev",
      implementer: null,
      delegatedBy: "user:boss",
      brief: "Batch the notices\nsecond line",
      unread: 0,
    });
    expect(gateway.desks).toHaveLength(1);
    expect(gateway.desks[0]!.agentId).toBe("acme_dev");
    expect(gateway.desks[0]!.text).toMatch(
      /^\[proposal #1\] boss asks you to write it: Batch the notices/,
    );
    expect(gateway.desks[0]!.text).toContain("penguin org proposal publish 1");
    // The author is given the skills plugin, once.
    expect(agents.updates).toEqual(["acme_dev"]);
    expect(gateway.events).toEqual([
      {
        type: "plugin",
        plugin: "company-proposals",
        data: { projectId: PROJECT, orgId: ORG, number: 1, seq: 1, kind: "created" },
      },
    ]);
    // The author must be an employee, and a person has to name one.
    expect(
      await refused(() => service.create(PROJECT, ORG, { author: "ghost", brief: "x" }, BOSS)),
    ).toEqual({
      status: 400,
      code: "bad_request",
    });
    expect(await refused(() => service.create(PROJECT, ORG, { brief: "x" }, BOSS))).toEqual({
      status: 400,
      code: "bad_request",
    });
    expect(
      (await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Another" }, BOSS)).number,
    ).toBe(2);
    expect(agents.updates).toEqual(["acme_dev"]);
  });

  it("an employee creates a proposal as a person does, under its own name; it still needs an author", async () => {
    const written = async (): Promise<number> => storeOf(root, (s) => s.facts().length);
    // No author named: refused, and nothing is written.
    const err = await service
      .create(PROJECT, ORG, { brief: "Rotate the API token" }, author)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: "bad_request" });
    expect(await written()).toBe(0);
    // Handed to a colleague: one created line, the colleague's desk told, the employee its delegator.
    const byEmployee = await service.create(
      PROJECT,
      ORG,
      { author: "acme_impl", brief: "Split" },
      author,
    );
    expect(byEmployee).toMatchObject({
      number: 1,
      author: "acme_impl",
      delegatedBy: "agent:acme_dev",
    });
    // A person's create is as it was.
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_impl", brief: "Split the sweep" },
      BOSS,
    );
    expect(created).toMatchObject({ number: 2, author: "acme_impl", delegatedBy: "user:boss" });
    expect(await written()).toBe(2);
    expect(gateway.desks).toEqual([
      { agentId: "acme_impl", text: expect.stringMatching(/^\[proposal #1\] acme_dev asks you/) },
      { agentId: "acme_impl", text: expect.stringMatching(/^\[proposal #2\] boss asks you/) },
    ]);
  });

  it("a roadmap creates an employee's proposal: it records the item, and the author hears it from the roadmap", async () => {
    const number = await service.createFromRoadmap(PROJECT, ORG, {
      author: "acme_dev",
      title: "Roadmap ledger",
      brief: "An append-only ledger.",
      delegatedBy: "agent:acme_ceo",
      roadmap: { number: 3, key: "ledger" },
    });
    expect(number).toBe(1);
    expect(storeOf(root, (s) => s.get(1))).toMatchObject({
      number: 1,
      title: "Roadmap ledger",
      author: "acme_dev",
      delegatedBy: "agent:acme_ceo",
      brief: "An append-only ledger.",
      roadmap: { number: 3, key: "ledger" },
      events: [{ kind: "created", by: "agent:acme_ceo" }],
    });
    // The roadmap tells the owner, with the number; this plugin does not tell it twice.
    expect(gateway.desks).toEqual([]);
    expect(agents.updates).toEqual(["acme_dev"]);
    expect(await service.get(PROJECT, ORG, 1, BOSS)).toMatchObject({
      author: "acme_dev",
      delegatedBy: "agent:acme_ceo",
      status: "drafting",
    });
    // The author must be an employee, and nothing is written when it is not.
    await expect(
      service.createFromRoadmap(PROJECT, ORG, {
        author: "ghost",
        title: "x",
        brief: "x",
        delegatedBy: "user:boss",
        roadmap: { number: 3, key: "x" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    expect(storeOf(root, (s) => s.facts())).toHaveLength(1);
  });

  it("the skills plugin is installed only where it is missing, and a library without it is only logged", async () => {
    agents.installed.add("acme_dev");
    await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Already equipped" }, BOSS);
    expect(agents.updates).toEqual([]);
    agents.library = null;
    await service.create(PROJECT, ORG, { author: "acme_impl", brief: "No library" }, BOSS);
    expect(agents.updates).toEqual([]);
    agents.library = "2026.09.21.1";
    agents.failInstall = true;
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_qa", brief: "Broken" },
      BOSS,
    );
    expect(created.number).toBe(3);
    expect(lines.some((l) => l.includes("agent-company-proposals not installed on acme_qa"))).toBe(
      true,
    );
  });

  it("an installed copy older than the library's is updated, so the author works from the current protocol", async () => {
    agents.installed.add("acme_dev");
    agents.outdated.add("acme_dev");
    await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Old copy" }, BOSS);
    expect(agents.updates).toEqual(["acme_dev"]);
    await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Current now" }, BOSS);
    expect(agents.updates).toEqual(["acme_dev"]);
  });

  it("an update removes the three skills penguin-proposal replaced, and nothing else", async () => {
    agents.installed.add("acme_dev");
    agents.outdated.add("acme_dev");
    agents.others.set(
      "acme_dev",
      new Set(["proposal-author", "proposal-implementer", "proposal-tester", "company-employee"]),
    );
    await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Old skills" }, BOSS);
    expect(agents.updates).toEqual(["acme_dev"]);
    expect(agents.removed).toEqual([
      "acme_dev/proposal-author",
      "acme_dev/proposal-implementer",
      "acme_dev/proposal-tester",
    ]);
    expect([...agents.others.get("acme_dev")!]).toEqual(["company-employee"]);
    // A failed install removes nothing: the old skills are all the employee has.
    agents.others.set("acme_qa", new Set(["proposal-author"]));
    agents.failInstall = true;
    await service.create(PROJECT, ORG, { author: "acme_qa", brief: "Broken" }, BOSS);
    expect([...agents.others.get("acme_qa")!]).toEqual(["proposal-author"]);
  });

  it("the author publishes and marks ready, and so may any other member", async () => {
    const n = await delegated();
    expect(await refused(() => service.ready(PROJECT, ORG, n, author))).toEqual({
      status: 409,
      code: "proposal_empty",
    });
    expect(await refused(() => service.publish(PROJECT, ORG, n, "no frontmatter", author))).toEqual(
      {
        status: 400,
        code: "proposal_title",
      },
    );
    const published = await service.publish(PROJECT, ORG, n, DOC, author);
    expect(published).toMatchObject({
      revision: 1,
      title: "Batch the ticket notices",
      status: "drafting",
    });
    expect(published.scope).toEqual([
      {
        kind: "edit",
        file: "packages/server/src/runtime/organization/reconcile.ts",
        name: "notifyTicket",
        state: "exists",
      },
    ]);
    expect(published.root).toBe("");
    expect(published.base).toBe(gateway.org!.workspace);
    expect(published.sections.map((s) => s.heading)).toEqual(["Change", "Purpose", "Test"]);
    const ready = await service.ready(PROJECT, ORG, n, author);
    expect(ready.status).toBe("ready");
    expect(ready.events.map((e) => e.kind)).toEqual(["created", "revised", "ready"]);
    expect(await refused(() => service.ready(PROJECT, ORG, n, author))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    // A second revision keeps the ids of the paragraphs it leaves alone.
    const second = await service.publish(
      PROJECT,
      ORG,
      n,
      DOC.replace("One sweep handles every change.", "One sweep, all changes."),
      author,
    );
    expect(second.revision).toBe(2);
    expect(second.sections[0]!.paragraphs.map((p) => p.id)).toEqual(
      published.sections[0]!.paragraphs.map((p) => p.id),
    );
    expect(second.sections[1]!.paragraphs[0]!.id).not.toBe(
      published.sections[1]!.paragraphs[0]!.id,
    );
    // A colleague publishes too, under its own name.
    const third = await service.publish(PROJECT, ORG, n, DOC, impl);
    expect(third.revision).toBe(3);
    expect(third.events.at(-1)).toMatchObject({ kind: "revised", by: "agent:acme_impl" });
  });

  it("the scope is checked at publish: an edit must exist under root, a missing path is refused with the likely one", async () => {
    const n = await delegated();
    const ws = gateway.org!.workspace;
    await fs.mkdir(path.join(ws, "repo/pkg/ctl/app"), { recursive: true });
    await fs.writeFile(path.join(ws, "repo/pkg/ctl/app/task_liveness.go"), "package app\n");
    await fs.mkdir(path.join(ws, "repo/deep/elsewhere"), { recursive: true });
    await fs.writeFile(path.join(ws, "repo/deep/elsewhere/runtime.go"), "package x\n");
    await fs.mkdir(path.join(ws, "repo/old"), { recursive: true });
    await fs.writeFile(path.join(ws, "repo/old/obsolete.go"), "package old\n");
    const doc = (root: string, scope: string) =>
      DOC.replace(
        /scope:\n[\s\S]*?---/,
        `${root === "" ? "" : `root: ${root}\n`}scope:\n${scope}\n---`,
      );
    // Not a directory of the workspace.
    expect(
      await refused(() => service.publish(PROJECT, ORG, n, doc("nope", "  - file: a.go"), author)),
    ).toEqual({ status: 400, code: "scope_root_missing" });
    // Missing edits: one moved out of `legacy/`, one found by name elsewhere.
    let message = "";
    try {
      await service.publish(
        PROJECT,
        ORG,
        n,
        doc(
          "repo",
          "  - file: pkg/legacy/ctl/app/task_liveness.go\n  - kind: delete\n    file: pkg/domain/runtime.go",
        ),
        author,
      );
    } catch (err) {
      expect(err).toMatchObject({ status: 400, code: "scope_missing" });
      message = (err as Error).message;
    }
    expect(message).toContain(
      "pkg/legacy/ctl/app/task_liveness.go — did you mean `pkg/ctl/app/task_liveness.go`?",
    );
    expect(message).toContain("pkg/domain/runtime.go — did you mean `deep/elsewhere/runtime.go`?");
    // A rename needs its source; a new file needs nothing, and one that exists already is a hint.
    expect(
      await refused(() =>
        service.publish(PROJECT, ORG, n, doc("repo", "  - kind: rename\n    file: b.go"), author),
      ),
    ).toEqual({ status: 400, code: "scope_invalid" });
    const published = await service.publish(
      PROJECT,
      ORG,
      n,
      doc(
        "repo",
        [
          "  - file: pkg/ctl/app/task_liveness.go",
          "  - kind: new",
          "    file: pkg/ctl/app/fresh.go",
          "  - kind: new",
          "    file: deep/elsewhere/runtime.go",
          "  - kind: rename",
          "    from: pkg/ctl/app/task_liveness.go",
          "    file: pkg/ctl/app/liveness.go",
          "  - kind: delete",
          "    file: old/obsolete.go",
        ].join("\n"),
      ),
      author,
    );
    expect(published.root).toBe("repo");
    expect(published.base).toBe(path.join(ws, "repo"));
    expect(published.hints).toEqual([
      "deep/elsewhere/runtime.go is listed as new but already exists — is it an edit?",
    ]);
    expect(published.scope.map((e) => [e.kind, e.file, e.from ?? null, e.state])).toEqual([
      ["edit", "pkg/ctl/app/task_liveness.go", null, "exists"],
      ["new", "pkg/ctl/app/fresh.go", null, "new"],
      ["new", "deep/elsewhere/runtime.go", null, "exists"],
      ["rename", "pkg/ctl/app/liveness.go", "pkg/ctl/app/task_liveness.go", "renamed"],
      ["delete", "old/obsolete.go", null, "exists"],
    ]);
    // The states move with the tree: the rename done, the delete done.
    await fs.rename(
      path.join(ws, "repo/pkg/ctl/app/task_liveness.go"),
      path.join(ws, "repo/pkg/ctl/app/liveness.go"),
    );
    await fs.rm(path.join(ws, "repo/old/obsolete.go"));
    const read = await service.get(PROJECT, ORG, n, BOSS);
    expect(read.scope.map((e) => e.state)).toEqual([
      "missing",
      "new",
      "exists",
      "exists",
      "deleted",
    ]);
    expect(read.hints).toBeUndefined();
    // A merged proposal is history: its scope is not checked again.
    await service.ready(PROJECT, ORG, n, author);
    await service.approve(PROJECT, ORG, n, BOSS);
    await service.merged(PROJECT, ORG, n, BOSS);
    const late = await service.publish(
      PROJECT,
      ORG,
      n,
      doc("repo", "  - file: gone/entirely.go"),
      author,
    );
    expect(late.revision).toBe(2);
  });

  it("serves a file under the proposal's base for the page's file panel, and nothing outside it", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    const file = "packages/server/src/runtime/organization/reconcile.ts";
    expect(await service.file(PROJECT, ORG, n, file, BOSS)).toMatchObject({
      path: file,
      content: "export {};\n",
      extension: "ts",
    });
    // An employee reads it too — the implementer's desk opens the same panel's data.
    expect(await service.file(PROJECT, ORG, n, file, author)).toMatchObject({ path: file });
    expect(await refused(() => service.file(PROJECT, ORG, n, "../secret", BOSS))).toEqual({
      status: 400,
      code: "bad_path",
    });
    expect(await refused(() => service.file(PROJECT, ORG, n, "nope.ts", BOSS))).toEqual({
      status: 404,
      code: "file_not_found",
    });
    expect(await refused(() => service.file(PROJECT, ORG, n, file, OUTSIDER))).toEqual({
      status: 403,
      code: "project_access",
    });
    expect(await refused(() => service.file(PROJECT, ORG, 99, file, BOSS))).toEqual({
      status: 404,
      code: "proposal_not_found",
    });
  });

  it("the tests are checked at publish like the scope: an existing test must be there, a new one in an existing file is a hint", async () => {
    const n = await delegated();
    const ws = gateway.org!.workspace;
    await fs.mkdir(path.join(ws, "packages/server/test"), { recursive: true });
    await fs.writeFile(path.join(ws, "packages/server/test/reconcile.test.ts"), "// tests\n");
    await fs.mkdir(path.join(ws, "packages/legacy/web/e2e"), { recursive: true });
    const withTests = (tests: string): string =>
      DOC.replace("---\n\n## Change", `tests:\n${tests}\n---\n\n## Change`);
    // An existing test whose file moved out of `legacy/`: refused, with the likely path.
    await fs.mkdir(path.join(ws, "packages/web/e2e"), { recursive: true });
    await fs.writeFile(path.join(ws, "packages/web/e2e/desk.spec.ts"), "// e2e\n");
    let message = "";
    try {
      await service.publish(
        PROJECT,
        ORG,
        n,
        withTests(
          '  - group: e2e\n    file: packages/legacy/web/e2e/desk.spec.ts\n    description: "a desk run shows the digest"',
        ),
        author,
      );
    } catch (err) {
      expect(err).toMatchObject({ status: 400, code: "tests_missing" });
      message = (err as Error).message;
    }
    expect(message).toContain(
      "packages/legacy/web/e2e/desk.spec.ts — did you mean `packages/web/e2e/desk.spec.ts`?",
    );
    // Existing and new tests: a new test going into a file that is there is a hint, not a refusal.
    const published = await service.publish(
      PROJECT,
      ORG,
      n,
      withTests(
        [
          "  - file: packages/server/test/reconcile.test.ts",
          '    name: "blocked ticket"',
          '    description: "a blocked ticket reaches its owner once"',
          "  - kind: new",
          "    group: integration",
          "    file: packages/server/test/digest.test.ts",
          '    description: "the digest lists every change"',
          "  - kind: new",
          "    file: packages/server/test/reconcile.test.ts",
          '    description: "a restart does not repeat a notice"',
        ].join("\n"),
      ),
      author,
    );
    expect(published.hints).toEqual([
      "test packages/server/test/reconcile.test.ts is listed as new and the file already exists — the new test goes into it.",
    ]);
    expect(published.tests.map((t) => [t.kind, t.group, t.file, t.state])).toEqual([
      ["existing", "unit", "packages/server/test/reconcile.test.ts", "exists"],
      ["new", "integration", "packages/server/test/digest.test.ts", "new"],
      ["new", "unit", "packages/server/test/reconcile.test.ts", "exists"],
    ]);
    // A deleted test must be there, like an existing one: a missing file is refused.
    await expect(
      service.publish(
        PROJECT,
        ORG,
        n,
        withTests(
          '  - kind: delete\n    file: packages/server/test/gone.test.ts\n    description: "per-change notices go away"',
        ),
        author,
      ),
    ).rejects.toMatchObject({ status: 400, code: "tests_missing" });
    // States follow the tree on read; the revision keeps its tests.
    await fs.rm(path.join(ws, "packages/server/test/reconcile.test.ts"));
    const read = await service.get(PROJECT, ORG, n, BOSS);
    expect(read.tests.map((t) => t.state)).toEqual(["missing", "new", "new"]);
    expect(
      (await service.revision(PROJECT, ORG, n, published.revision, BOSS)).tests.map((t) => t.file),
    ).toHaveLength(3);
  });

  it("tests use only the declared groups, in the declared order, and a save applies to the next publish", async () => {
    const n = await delegated();
    const stored: Record<string, unknown> = {};
    const configured = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      pluginConfig: { get: (name) => (name === CONFIG_GROUP ? stored : {}) },
    });
    const ws = gateway.org!.workspace;
    await fs.mkdir(path.join(ws, "packages/server/test"), { recursive: true });
    await fs.writeFile(path.join(ws, "packages/server/test/reconcile.test.ts"), "// t\n");
    const withGroup = (group: string): string =>
      DOC.replace(
        "---\n\n## Change",
        `tests:\n  - group: ${group}\n    file: packages/server/test/reconcile.test.ts\n    description: "a blocked ticket reaches its owner once"\n---\n\n## Change`,
      );
    // The defaults: `perf` is not one of them — refused, with the declared list.
    let message = "";
    try {
      await configured.publish(PROJECT, ORG, n, withGroup("perf"), author);
    } catch (err) {
      expect(err).toMatchObject({ status: 400, code: "tests_group_undeclared" });
      message = (err as Error).message;
    }
    expect(message).toContain("not declared: perf");
    expect(message).toContain("- e2e: the product end to end, through its UI or CLI");
    // An admin declares it (Settings → Plugins): the next publish takes it, no restart.
    stored.testGroups = ["perf: timings under load", "unit: one module in isolation, no I/O"];
    const published = await configured.publish(PROJECT, ORG, n, withGroup("perf"), author);
    expect(published.tests.map((t) => t.group)).toEqual(["perf"]);
    const read = await configured.get(PROJECT, ORG, n, BOSS);
    expect(read.testGroups).toEqual([
      { id: "perf", description: "timings under load" },
      { id: "unit", description: "one module in isolation, no I/O" },
    ]);
    expect((await configured.listTestGroups(PROJECT, ORG, author)).groups.map((g) => g.id)).toEqual(
      ["perf", "unit"],
    );
    await expect(configured.listTestGroups(PROJECT, ORG, OUTSIDER)).rejects.toMatchObject({
      status: 403,
    });
    // Taken back out: the published revision keeps its group (nothing is rewritten); the next publish must move it.
    stored.testGroups = ["unit: one module in isolation, no I/O"];
    const after = await configured.get(PROJECT, ORG, n, BOSS);
    expect(after.tests.map((t) => t.group)).toEqual(["perf"]);
    expect(after.testGroups?.map((g) => g.id)).toEqual(["unit"]);
    await expect(
      configured.publish(PROJECT, ORG, n, withGroup("perf"), author),
    ).rejects.toMatchObject({ status: 400, code: "tests_group_undeclared" });
    expect((await configured.publish(PROJECT, ORG, n, withGroup("unit"), author)).revision).toBe(
      published.revision + 1,
    );
  });

  it("a revision published without tests reads with no tests", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    const again = newService({
      ...offline(),
      gateway,
      root,
      agents,
      log: { line: () => {} },
    });
    const read = await again.get(PROJECT, ORG, n, BOSS);
    expect(read.tests).toEqual([]);
    expect(storeOf(root, (s) => s.revision(n, 1)?.tests)).toEqual([]);
  });

  it("the author's ready answers a request for changes: a revision after it, and every comment resolved", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    const detail = await service.get(PROJECT, ORG, n, BOSS);
    const change = detail.sections[0]!;
    const source = sectionSource(change);
    const start = source.indexOf("notifyTicket");
    const commented = await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: change.id, start, end: start + 12, quote: "notifyTicket", text: "why?" },
      BOSS,
    );
    const commentId = commented.comments[0]!.id;
    await service.requestChanges(PROJECT, ORG, n, BOSS);
    // Straight back to ready: refused, naming the command to run.
    let message = "";
    try {
      await service.ready(PROJECT, ORG, n, author);
    } catch (err) {
      expect(err).toMatchObject({ status: 409, code: "changes_pending" });
      message = (err as Error).message;
    }
    expect(message).toContain(commentId);
    expect(message).toMatch(/`penguin org proposal comments \d+ --pending`$/);
    // A revision alone is not enough while a comment stands unresolved.
    await service.publish(PROJECT, ORG, n, DOC.replace("One sweep", "A single sweep"), author);
    expect(await refused(() => service.ready(PROJECT, ORG, n, author))).toEqual({
      status: 409,
      code: "changes_pending",
    });
    await service.resolve(PROJECT, ORG, n, commentId, "Named the caller.", author);
    expect((await service.ready(PROJECT, ORG, n, author)).status).toBe("ready");
  });

  it("anybody but the author may mark ready past unanswered changes — a colleague as a person may", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    const change = (await service.get(PROJECT, ORG, n, BOSS)).sections[0]!;
    const start = sectionSource(change).indexOf("notifyTicket");
    await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: change.id, start, end: start + 12, quote: "notifyTicket", text: "x" },
      BOSS,
    );
    await service.requestChanges(PROJECT, ORG, n, BOSS);
    expect((await service.ready(PROJECT, ORG, n, qa)).status).toBe("ready");
  });

  it("comments are the person's own until requested; one request is one batch and one line on the author's desk", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    const published = await service.get(PROJECT, ORG, n, BOSS);
    const change = published.sections[0]!;
    const purpose = published.sections[1]!;
    const changeSource = change.paragraphs.map((p) => p.text).join("\n\n");
    const at = (source: string, words: string) => {
      const start = source.indexOf(words);
      expect(start).toBeGreaterThanOrEqual(0);
      return { start, end: start + words.length, quote: words };
    };
    const first = at(changeSource, "notifyTicket");
    expect(
      await refused(() =>
        service.comment(PROJECT, ORG, n, { sectionId: "nope", ...first, text: "x" }, BOSS),
      ),
    ).toEqual({
      status: 400,
      code: "bad_request",
    });
    // The quote must read as the range says: a stale page cannot anchor to the wrong words.
    expect(
      await refused(() =>
        service.comment(
          PROJECT,
          ORG,
          n,
          { sectionId: change.id, start: first.start, end: first.end, quote: "other", text: "x" },
          BOSS,
        ),
      ),
    ).toEqual({
      status: 400,
      code: "comment_range",
    });
    expect(
      await refused(() =>
        service.comment(
          PROJECT,
          ORG,
          n,
          { sectionId: change.id, start: 5, end: 5, quote: "", text: "x" },
          BOSS,
        ),
      ),
    ).toEqual({
      status: 400,
      code: "comment_range",
    });
    expect(await refused(() => service.requestChanges(PROJECT, ORG, n, BOSS))).toEqual({
      status: 400,
      code: "bad_request",
    });

    await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: change.id, ...first, text: "Who reads the notices?" },
      BOSS,
    );
    const purposeSource = purpose.paragraphs.map((p) => p.text).join("\n\n");
    const second = at(purposeSource, purpose.paragraphs[0]!.text.slice(0, 12));
    const mine = await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: purpose.id, ...second, text: "Say which sweep." },
      BOSS,
    );
    expect(mine.pendingComments).toBe(2);
    expect(mine.comments.map((c) => c.batchId)).toEqual([null, null]);
    expect(mine.comments[0]).toMatchObject({
      sectionId: change.id,
      range: { start: first.start, end: first.end },
      quote: "notifyTicket",
      paragraphId: change.paragraphs[0]!.id,
      revision: 1,
    });
    // The author sees nothing yet; the messages so far are the delegation only.
    const seenByAuthor = await service.get(PROJECT, ORG, n, author);
    expect(seenByAuthor.comments).toEqual([]);
    expect(seenByAuthor.pendingComments).toBe(0);
    expect((await service.comments(PROJECT, ORG, n, { pending: true }, author)).comments).toEqual(
      [],
    );
    expect(gateway.desks).toHaveLength(1);

    const requested = await service.requestChanges(PROJECT, ORG, n, BOSS);
    expect(requested.status).toBe("drafting");
    expect(requested.pendingComments).toBe(0);
    expect(requested.comments.map((c) => c.batchId)).toEqual(["b1", "b1"]);
    expect(requested.events.at(-1)).toMatchObject({
      kind: "changes_requested",
      by: "user:boss",
      text: "2",
    });
    expect(gateway.desks).toHaveLength(2);
    expect(gateway.desks[1]!.agentId).toBe("acme_dev");
    expect(gateway.desks[1]!.text).toContain(
      "[proposal #1] boss requested changes: a batch of 2 comments",
    );
    expect(gateway.desks[1]!.text).toContain(`penguin org proposal comments ${n} --pending`);

    // What the author reads: the passages marked in the text, the comments by id, no offsets.
    const forAuthor = await service.comments(PROJECT, ORG, n, { pending: true }, author);
    expect(forAuthor.comments).toHaveLength(2);
    const [firstComment] = forAuthor.comments;
    expect(forAuthor.text).toContain(`⟦${firstComment!.id}⟧notifyTicket⟦/${firstComment!.id}⟧`);
    expect(forAuthor.text).toContain(
      `⟦${firstComment!.id}⟧ user:boss (open): Who reads the notices?`,
    );
    expect(forAuthor.text).toContain(`penguin org proposal resolve ${n} <id>`);
    // No offsets: not the pair, not the words — the ids may carry digits of their own.
    expect(forAuthor.text).not.toContain(`${first.start}, ${first.end}`);
    expect(forAuthor.text).not.toMatch(/\bstart\b|\brange\b|\boffset\b/);
    const resolved = await service.resolve(
      PROJECT,
      ORG,
      n,
      firstComment!.id,
      "Named the reader.",
      author,
    );
    expect(resolved.comments[0]!.resolved).toMatchObject({
      by: "agent:acme_dev",
      text: "Named the reader.",
    });
    expect(
      (await service.comments(PROJECT, ORG, n, { pending: true }, author)).comments,
    ).toHaveLength(1);
    expect(
      await refused(() => service.resolve(PROJECT, ORG, n, firstComment!.id, "again", author)),
    ).toEqual({
      status: 409,
      code: "comment_resolved",
    });
    expect(await refused(() => service.resolve(PROJECT, ORG, n, "nope", "x", author))).toEqual({
      status: 404,
      code: "comment_not_found",
    });

    // A revision moves the passage; the comment follows it. A passage that is gone leaves
    // its comment on the revision it was last seen in.
    const moved = DOC.replace("## Change\n\n", "## Change\n\nAdded first.\n\n");
    const afterMove = await service.publish(PROJECT, ORG, n, moved, author);
    const followed = afterMove.comments.find((c) => c.id === firstComment!.id)!;
    expect(followed.revision).toBe(2);
    expect(followed.range.start).toBe(first.start + "Added first.\n\n".length);
    // The body's token, not the scope's `name:` — a replace of the first occurrence would
    // hit the frontmatter and leave the passage where it was.
    const gone = DOC.replace("`notifyTicket`", "`somethingElse`");
    const afterGone = await service.publish(PROJECT, ORG, n, gone, author);
    const orphan = afterGone.comments.find((c) => c.id === firstComment!.id)!;
    expect(orphan.revision).toBe(2);
    expect(orphan.paragraphId).toBeUndefined();
    expect((await service.comments(PROJECT, ORG, n, { pending: false }, BOSS)).text).toContain(
      `(on revision 2: "notifyTicket")`,
    );
  });

  it("implement opens the implementer's session on the proposal's text", async () => {
    const n = await delegated();
    expect(
      await refused(() => service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author)),
    ).toEqual({
      status: 409,
      code: "proposal_empty",
    });
    await service.publish(PROJECT, ORG, n, DOC, author);
    expect(
      await refused(() => service.implement(PROJECT, ORG, n, { agentId: "ghost" }, author)),
    ).toEqual({
      status: 400,
      code: "bad_request",
    });
    const started = await service.implement(
      PROJECT,
      ORG,
      n,
      { agentId: "acme_impl", message: "Mind the tests." },
      author,
    );
    expect(started).toMatchObject({
      implementer: "acme_impl",
      sessions: ["impl-1"],
      sessionId: "impl-1",
    });
    expect(gateway.sessions).toHaveLength(1);
    const session = gateway.sessions[0]!;
    expect(session.title).toBe("Proposal #1: Batch the ticket notices");
    expect(session.body).toContain(`proposal/${n}-batch-the-ticket-notices`);
    expect(session.body).toContain(`penguin org proposal material ${n} add pr=`);
    expect(session.body).toContain(`penguin org proposal feedback ${n} -m`);
    expect(session.body).toContain(`penguin org proposal merged ${n}`);
    expect(session.body).toContain("Note from the author: Mind the tests.");
    expect(session.body).toContain("## Change");
    expect(session.body).toContain('title: "Batch the ticket notices"');
    // The session's first input is the notice; no desk line besides the delegation's.
    expect(gateway.desks.map((d) => d.agentId)).toEqual(["acme_dev"]);
    expect(started.events.at(-1)).toMatchObject({
      kind: "implementation_started",
      text: "acme_impl",
    });
    // The implementer is equipped too (the author was at the delegation).
    expect(agents.updates).toEqual(["acme_dev", "acme_impl"]);
  });

  it("implement without an implementer is the author building its own proposal", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    const started = await service.implement(PROJECT, ORG, n, {}, author);
    expect(started).toMatchObject({ implementer: "acme_dev", sessions: ["impl-1"] });
    expect(gateway.sessions[0]).toMatchObject({ agentId: "acme_dev" });
    expect(agents.updates).toEqual(["acme_dev"]);
  });

  describe("a discussion with the owner", () => {
    /** The owner speaking from inside the discussion's own session (the CLI's control environment). */
    const inside = (agentId: string, sessionId: string): OrgActor => ({
      userId: "boss",
      agentId,
      sessionId,
    });

    it("opens a discussion with the owner, in a session of its own started on the proposal", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const desksBefore = gateway.desks.length;
      // No implementer yet: the author holds it.
      const opened = await service.discuss(PROJECT, ORG, n, BOSS);
      expect(opened.sessionId).toBe("impl-1");
      expect(gateway.sessions).toEqual([
        {
          projectId: PROJECT,
          orgId: ORG,
          agentId: "acme_dev",
          title: "Discussion: proposal #1 — Batch the ticket notices",
          body: expect.any(String),
        },
      ]);
      const body = gateway.sessions[0]!.body;
      // Where it stands, and the proposal itself.
      expect(body).toContain(
        `discussion of proposal #${n} (\`proposal:${n}\`) of organization ${ORG}`,
      );
      expect(body).toContain("with boss, a person of the Project. You are its author.");
      expect(body).toContain("This is not your desk");
      expect(body).toContain(`penguin org proposal conclude ${n} --org-id ${ORG} -m`);
      expect(body).toContain("The proposal, revision 1:");
      expect(body).toContain("## Change");
      expect(body).toContain("`notifyTicket` writes `org_desk_notices`");
      // The desk is not told of it.
      expect(gateway.desks).toHaveLength(desksBefore);
      expect(opened.discussions).toEqual([
        {
          sessionId: "impl-1",
          agentId: "acme_dev",
          by: "user:boss",
          at: expect.any(String),
          concluded: null,
        },
      ]);
      expect(opened.events.at(-1)).toMatchObject({
        kind: "discussion_started",
        text: "acme_dev",
        by: "user:boss",
      });
      expect(gateway.events.at(-1)).toMatchObject({
        type: "plugin",
        data: { number: n, kind: "discussion_started" },
      });

      // With an implementer named, the implementer holds it.
      await service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author);
      const second = await service.discuss(PROJECT, ORG, n, BOSS);
      expect(gateway.sessions.at(-1)).toMatchObject({ agentId: "acme_impl" });
      expect(gateway.sessions.at(-1)!.body).toContain("You are its implementer.");
      expect(second.discussions.map((d) => [d.sessionId, d.agentId])).toEqual([
        ["impl-1", "acme_dev"],
        ["impl-3", "acme_impl"],
      ]);
      // Not an implementation session: the implementation's list is unchanged.
      expect(second.sessions).toEqual(["impl-2"]);
    });

    it("an unpublished proposal is discussed on its brief", async () => {
      const n = await delegated();
      await service.discuss(PROJECT, ORG, n, BOSS);
      expect(gateway.sessions[0]!.body).toContain(
        "No revision is published yet. The brief:\n\nBatch the notices",
      );
    });

    it("delivers the conclusion to the owner's desk exactly once", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const { sessionId } = await service.discuss(PROJECT, ORG, n, BOSS);
      const before = gateway.desks.length;
      const concluded = await service.conclude(
        PROJECT,
        ORG,
        n,
        sessionId,
        "  Keep notifyTicket; batch only the digest.  ",
        inside("acme_dev", sessionId),
      );
      expect(gateway.desks.slice(before)).toEqual([
        {
          agentId: "acme_dev",
          text: `[proposal #${n}] the discussion with boss concluded (session ${sessionId}):\n\nKeep notifyTicket; batch only the digest.\n\nRead it against the proposal (\`penguin org proposal show ${n}\`); if it changes what is proposed, revise the proposal or the branch.`,
        },
      ]);
      expect(concluded.discussions[0]!.concluded).toEqual({
        by: "agent:acme_dev",
        at: expect.any(String),
        text: "Keep notifyTicket; batch only the digest.",
      });
      expect(concluded.events.at(-1)).toMatchObject({
        kind: "discussion_concluded",
        text: "Keep notifyTicket; batch only the digest.",
      });
      // Once: a second conclusion is refused and nothing more reaches the desk.
      expect(
        await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "again", BOSS)),
      ).toEqual({ status: 409, code: "discussion_concluded" });
      expect(gateway.desks.slice(before).filter((d) => d.agentId === "acme_dev")).toHaveLength(1);
      // Two at once: one delivery.
      const other = await service.discuss(PROJECT, ORG, n, BOSS);
      const race = await Promise.allSettled([
        service.conclude(PROJECT, ORG, n, other.sessionId, "first", BOSS),
        service.conclude(PROJECT, ORG, n, other.sessionId, "second", BOSS),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(gateway.desks.slice(before)).toHaveLength(2);
      // A new service over the same store reads the same discussions.
      const again = newService({
        ...offline(),
        gateway,
        agents,
        root,
        log,
      });
      expect((await again.get(PROJECT, ORG, n, BOSS)).discussions).toEqual(
        (await service.get(PROJECT, ORG, n, BOSS)).discussions,
      );
    });

    it("any member concludes it, once: a person, the discussion's session or another employee", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const { sessionId } = await service.discuss(PROJECT, ORG, n, BOSS);
      const before = gateway.desks.length;
      expect(await refused(() => service.conclude(PROJECT, ORG, n, "nope", "x", BOSS))).toEqual({
        status: 404,
        code: "discussion_not_found",
      });
      expect(await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "  ", BOSS))).toEqual(
        {
          status: 400,
          code: "bad_request",
        },
      );
      expect(gateway.desks).toHaveLength(before);
      // A colleague's session concludes it as a person would; once concluded, nobody again.
      const done = await service.conclude(
        PROJECT,
        ORG,
        n,
        sessionId,
        "Agreed.",
        inside("acme_qa", "desk-qa"),
      );
      expect(done.discussions[0]!.concluded).toMatchObject({ by: "agent:acme_qa" });
      expect(gateway.desks.slice(before).map((d) => d.agentId)).toEqual(["acme_dev"]);
      expect(await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "x", BOSS))).toEqual({
        status: 409,
        code: "discussion_concluded",
      });
    });

    it("refuses a discussion nobody can hold", async () => {
      const n = await delegated();
      // An employee opens one as a person does, and is refused for the same reasons.
      gateway.org!.status = "paused";
      expect(await refused(() => service.discuss(PROJECT, ORG, n, author))).toEqual({
        status: 409,
        code: "org_paused",
      });
      gateway.org!.status = "active";
      // The author left the organization and nobody implements it.
      gateway.org!.employees = gateway.org!.employees.filter((e) => e.agentId !== "acme_dev");
      expect(await refused(() => service.discuss(PROJECT, ORG, n, BOSS))).toEqual({
        status: 409,
        code: "owner_unavailable",
      });
      expect(gateway.sessions).toEqual([]);
      const m = (await service.create(PROJECT, ORG, { author: "acme_qa", brief: "Closed" }, BOSS))
        .number;
      await service.reject(PROJECT, ORG, m, "not now", BOSS);
      expect(await refused(() => service.discuss(PROJECT, ORG, m, BOSS))).toEqual({
        status: 409,
        code: "proposal_status",
      });
      expect(gateway.sessions).toEqual([]);
      expect(await refused(() => service.discuss(PROJECT, ORG, 99, BOSS))).toEqual({
        status: 404,
        code: "proposal_not_found",
      });
    });

    it("a conclusion the desk cannot take is answered with the reason, recorded, and the discussion stays open", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const { sessionId } = await service.discuss(PROJECT, ORG, n, BOSS);
      const before = gateway.desks.length;
      gateway.refuse.set(
        "acme_dev",
        "acme_dev is paused by its budget for 2026-09; it was not told.",
      );
      gateway.refuseCodes.set("acme_dev", "employee_paused");
      expect(
        await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "Ship it.", BOSS)),
      ).toEqual({ status: 409, code: "employee_paused" });
      const held = await service.get(PROJECT, ORG, n, BOSS);
      expect(held.discussions[0]!.concluded).toBeNull();
      expect(held.events.at(-1)).toMatchObject({
        kind: "notify_failed",
        text: "agent:acme_dev not notified: acme_dev is paused by its budget for 2026-09; it was not told.",
      });
      gateway.refuse.set("acme_dev", "Acme is paused; acme_dev was not told.");
      gateway.refuseCodes.set("acme_dev", "org_paused");
      expect(
        await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "Ship it.", BOSS)),
      ).toEqual({ status: 409, code: "org_paused" });
      gateway.refuse.set("acme_dev", "no desk");
      gateway.refuseCodes.set("acme_dev", "desk_unavailable");
      expect(
        await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "Ship it.", BOSS)),
      ).toEqual({ status: 409, code: "desk_unavailable" });
      expect(gateway.desks).toHaveLength(before);
      // Resolved: the same discussion concludes, once.
      gateway.refuse.clear();
      const done = await service.conclude(PROJECT, ORG, n, sessionId, "Ship it.", BOSS);
      expect(done.discussions[0]!.concluded?.text).toBe("Ship it.");
      expect(gateway.desks.slice(before)).toHaveLength(1);
    });

    it("proposal.discuss opens one; proposal.conclude carries the caller's identity and concludes once", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const { run } = routes();
      const opened = await run("proposal.discuss", `proposal:${n}`);
      expect(opened.status).toBe(200);
      const { sessionId } = (await opened.json()) as { sessionId: string };
      expect(sessionId).toBe("impl-1");
      const subject = `discussion:${n}/${sessionId}`;
      const missing = await run("proposal.conclude", subject, {});
      expect(missing.status).toBe(400);
      // Any member concludes it — here the owner's desk, under its own name — and only once.
      const desk = await run("proposal.conclude", subject, { text: "Agreed." }, author);
      expect(desk.status).toBe(200);
      const detail = (await desk.json()) as {
        discussions: Array<{ concluded: { by: string } | null }>;
      };
      expect(detail.discussions[0]!.concluded).toMatchObject({ by: "agent:acme_dev" });
      const again = await run(
        "proposal.conclude",
        subject,
        { text: "x" },
        { userId: "boss", agentId: "acme_dev", sessionId },
      );
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
        "discussion_concluded",
      );
      expect(gateway.desks.filter((d) => d.text.includes("concluded (session"))).toHaveLength(1);
    });
  });

  it("materials, feedback and runtime feedback: the author is told, runtime feedback tells the implementer too", async () => {
    const forge = new FakeForge([
      cr("x/y", 42, { head: "b".repeat(40), branch: "fix", state: "merged" }),
    ]);
    service = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      gh: githubGh,
      forge,
    });
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author);
    const withPr = await service.addMaterial(
      PROJECT,
      ORG,
      n,
      { kind: "pr", url: "https://github.com/x/y/pull/42" },
      impl,
    );
    expect(withPr.materials).toEqual([
      expect.objectContaining({
        kind: "pr",
        label: "PR #42",
        url: "https://github.com/x/y/pull/42",
        by: "agent:acme_impl",
      }),
    ]);
    // The write's answer carries no status; a read answers what is cached at once and asks the
    // forge in the background, in one batch; the next read has it.
    expect(withPr.materials[0]!.status).toBeUndefined();
    expect((await service.get(PROJECT, ORG, n, BOSS)).materials[0]!.status).toBeUndefined();
    await service.prStatusSettled(PROJECT, ORG, n);
    const read = await service.get(PROJECT, ORG, n, BOSS);
    expect(read.materials[0]).toMatchObject({ status: "merged" });
    expect(typeof read.materials[0]!.statusCheckedAt).toBe("string");
    expect(forge.queries).toEqual([{ repo: "x/y", numbers: [42] }]);
    expect(
      await refused(() => service.addMaterial(PROJECT, ORG, n, { kind: "pr", url: "  " }, impl)),
    ).toEqual({
      status: 400,
      code: "bad_request",
    });
    const before = gateway.desks.length;
    const fed = await service.feedback(
      PROJECT,
      ORG,
      n,
      { text: "digest.ts needs a change too" },
      impl,
    );
    expect(fed.events.at(-1)).toMatchObject({
      kind: "feedback",
      by: "agent:acme_impl",
      text: "digest.ts needs a change too",
    });
    expect(gateway.desks.slice(before)).toEqual([
      {
        agentId: "acme_dev",
        text: expect.stringMatching(/^\[proposal #1\] feedback from acme_impl: digest\.ts needs/),
      },
    ]);
    const runtime = await service.feedback(
      PROJECT,
      ORG,
      n,
      { text: "crashes on an empty board", runtime: true },
      qa,
    );
    expect(runtime.events.at(-1)).toMatchObject({ kind: "runtime_feedback", by: "agent:acme_qa" });
    expect(gateway.desks.slice(before + 1).map((d) => d.agentId)).toEqual([
      "acme_dev",
      "acme_impl",
    ]);
    expect(gateway.desks.at(-1)!.text).toMatch(
      /^\[proposal #1\] runtime feedback from acme_qa: crashes on an empty board/,
    );
    // The implementer's own runtime finding goes to the author alone: nobody is told of their own act.
    const mark = gateway.desks.length;
    await service.feedback(PROJECT, ORG, n, { text: "slow start", runtime: true }, impl);
    expect(gateway.desks.slice(mark).map((d) => d.agentId)).toEqual(["acme_dev"]);
  });

  it("an employee reports the merge once GitHub reads the impl PR as merged into its default branch", async () => {
    const url = "https://github.com/acme/site/pull/11";
    const forge = new FakeForge();
    const asked = (): number => forge.queries.length;
    const pull = (state: "open" | "merged" | "closed", base: string) => {
      forge.pulls = [cr("acme/site", 11, { head: "a".repeat(40), branch: "feat", state, base })];
    };
    pull("open", "main");
    service = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
      gh: githubGh,
      forge,
    });

    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    await service.setImpl(PROJECT, ORG, n, { url }, author);
    await service.graphSettled(PROJECT, ORG);
    // Before approval the status answers first, the forge is not asked.
    const before = asked();
    expect(await refused(() => service.merged(PROJECT, ORG, n, qa))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    expect(asked()).toBe(before);

    await service.approve(PROJECT, ORG, n, BOSS);
    // Nobody builds it: the notice names the impl PR and the command anybody may run once it lands.
    expect(gateway.desks.at(-1)).toEqual({
      agentId: "acme_dev",
      text: `[proposal #${n}] approved by boss with nobody building it yet — build it with \`penguin org proposal implement ${n}\` (or \`--agent <id>\` to hand it to a colleague); once its impl PR acme/site#11 is merged into the default branch, run \`penguin org proposal merged ${n}\`.`,
    });

    // The page read caches `open`; the merge check asks the forge again all the same.
    await service.addMaterial(PROJECT, ORG, n, { kind: "pr", url }, author);
    await service.get(PROJECT, ORG, n, BOSS);
    await service.prStatusSettled(PROJECT, ORG, n);
    expect((await service.get(PROJECT, ORG, n, BOSS)).materials).toMatchObject([
      { url, status: "open" },
    ]);
    const refusal = async (): Promise<string> => {
      try {
        await service.merged(PROJECT, ORG, n, qa);
      } catch (err) {
        const e = err as ProposalError;
        expect([e.status, e.code]).toEqual([409, "impl_pr_not_merged"]);
        return e.message;
      }
      throw new Error("merged() was not refused");
    };
    expect(await refusal()).toContain("impl PR acme/site#11 is open");
    pull("merged", "dev");
    expect(await refusal()).toContain("merged into dev, not the default branch main");
    forge.failWith = "HTTP 502";
    expect(await refusal()).toContain("could not be read from GitHub");
    forge.failWith = null;
    expect((await service.get(PROJECT, ORG, n, BOSS)).status).toBe("approved");

    pull("merged", "main");
    const merged = await service.merged(PROJECT, ORG, n, qa);
    expect(merged.status).toBe("merged");
    expect(merged.events.at(-1)).toMatchObject({ kind: "merged", by: "agent:acme_qa" });
    // The answer is written back to the cache the page reads.
    expect((await service.get(PROJECT, ORG, n, BOSS)).materials).toMatchObject([
      { url, status: "merged" },
    ]);
    // Terminal: a second report is a status refusal, not another forge read.
    const reads = asked();
    expect(await refused(() => service.merged(PROJECT, ORG, n, author))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    expect(asked()).toBe(reads);
  });

  it("approve, merge and reject: who may, from which status, and who is told", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    expect(await refused(() => service.merged(PROJECT, ORG, n, impl))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    expect(await refused(() => service.merged(PROJECT, ORG, n, BOSS))).toEqual({
      status: 409,
      code: "proposal_status",
    });

    const approvedNoImpl = await service.approve(PROJECT, ORG, n, BOSS);
    expect(approvedNoImpl.status).toBe("approved");
    expect(gateway.desks.at(-1)).toEqual({
      agentId: "acme_dev",
      text: expect.stringContaining("[proposal #1] approved by boss with nobody building it yet"),
    });

    // A second proposal, with an implementer: approval goes to the implementer, who reports the merge.
    const m = (await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Second" }, BOSS))
      .number;
    await service.publish(PROJECT, ORG, m, DOC, author);
    await service.implement(PROJECT, ORG, m, { agentId: "acme_impl" }, author);
    await service.approve(PROJECT, ORG, m, BOSS);
    expect(gateway.desks.at(-1)).toEqual({
      agentId: "acme_impl",
      text: `[proposal #${m}] approved by boss — merge the PR and run \`penguin org proposal merged ${m}\`.`,
    });
    // Anybody else needs the impl PR to check the merge against; m has none.
    expect(await refused(() => service.merged(PROJECT, ORG, m, author))).toEqual({
      status: 409,
      code: "impl_pr_missing",
    });
    const merged = await service.merged(PROJECT, ORG, m, impl);
    expect(merged.status).toBe("merged");
    expect(await refused(() => service.reject(PROJECT, ORG, m, "late", BOSS))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    // A merged proposal may still be revised (the record of what landed can be sharpened); a rejected one may not.
    expect((await service.publish(PROJECT, ORG, m, DOC, author)).revision).toBe(2);

    // Rejecting the first: a reason is required, the author (and any implementer) is told.
    expect(await refused(() => service.reject(PROJECT, ORG, n, " ", BOSS))).toEqual({
      status: 400,
      code: "bad_request",
    });
    const rejected = await service.reject(PROJECT, ORG, n, "Not this quarter.", BOSS);
    expect(rejected.status).toBe("rejected");
    expect(rejected.events.at(-1)).toMatchObject({ kind: "rejected", text: "Not this quarter." });
    expect(gateway.desks.at(-1)).toEqual({
      agentId: "acme_dev",
      text: expect.stringContaining("[proposal #1] rejected by boss: Not this quarter."),
    });
    expect(await refused(() => service.publish(PROJECT, ORG, n, DOC, author))).toEqual({
      status: 409,
      code: "proposal_closed",
    });
  });

  it("an employee rejects as a person does: any open proposal, with a reason, under its own name; the author and implementer are told, never the one who rejected", async () => {
    const ceo: OrgActor = { userId: "boss", agentId: "acme_ceo", sessionId: "desk-ceo" };
    // A colleague's ready proposal with an implementer, taken off the queue by another employee.
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author);
    await service.ready(PROJECT, ORG, n, author);
    expect(await refused(() => service.reject(PROJECT, ORG, n, "  ", ceo))).toEqual({
      status: 400,
      code: "bad_request",
    });
    const mark = gateway.desks.length;
    const rejected = await service.reject(PROJECT, ORG, n, "The board withdrew it.", ceo);
    expect(rejected.status).toBe("rejected");
    expect(rejected.events.at(-1)).toMatchObject({
      kind: "rejected",
      by: "agent:acme_ceo",
      text: "The board withdrew it.",
    });
    const told = `[proposal #${n}] rejected by acme_ceo: The board withdrew it. — stop work on it, and close its PR if one is open.`;
    expect(gateway.desks.slice(mark)).toEqual([
      { agentId: "acme_dev", text: told },
      { agentId: "acme_impl", text: told },
    ]);
    // Closed for everyone after that, whoever rejected it.
    expect(await refused(() => service.reject(PROJECT, ORG, n, "again", qa))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    expect(await refused(() => service.publish(PROJECT, ORG, n, DOC, author))).toEqual({
      status: 409,
      code: "proposal_closed",
    });

    // The author drops its own empty draft: nobody else is on it, so nobody is told.
    const own = await service.createFromRoadmap(PROJECT, ORG, {
      author: "acme_dev",
      title: "Folded into #1",
      brief: "Folded into #1",
      delegatedBy: "user:boss",
      roadmap: { number: 1, key: "fold" },
    });
    const before = gateway.desks.length;
    const dropped = await service.reject(PROJECT, ORG, own, "Folded into #1.", author);
    expect(dropped).toMatchObject({ status: "rejected", revision: 0 });
    expect(dropped.events.at(-1)).toMatchObject({ kind: "rejected", by: "agent:acme_dev" });
    expect(gateway.desks).toHaveLength(before);

    // An approved proposal too: the person's approval does not lock it against an employee.
    const k = await delegated();
    await service.publish(PROJECT, ORG, k, DOC, author);
    await service.approve(PROJECT, ORG, k, BOSS);
    expect((await service.reject(PROJECT, ORG, k, "Superseded.", qa)).status).toBe("rejected");

    // Someone outside the organization still cannot.
    const m = await delegated();
    expect(await refused(() => service.reject(PROJECT, ORG, m, "no", OUTSIDER))).toEqual({
      status: 403,
      code: "project_access",
    });

    // A new service over the same store reads the same record.
    const again = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
    });
    expect((await again.get(PROJECT, ORG, n, BOSS)).events.at(-1)).toMatchObject({
      kind: "rejected",
      by: "agent:acme_ceo",
    });
  });

  it("proposal.reject carries an employee's identity; the reason is required", async () => {
    const n = await delegated();
    const { run } = routes();
    const missing = await run("proposal.reject", `proposal:${n}`, {}, qa);
    expect(missing.status).toBe(400);
    const ok = await run("proposal.reject", `proposal:${n}`, { reason: "Not this quarter." }, qa);
    expect(ok.status).toBe(200);
    const detail = (await ok.json()) as {
      status: string;
      events: Array<{ kind: string; by: string }>;
    };
    expect(detail.status).toBe("rejected");
    expect(detail.events.at(-1)).toMatchObject({ kind: "rejected", by: "agent:acme_qa" });
  });

  it("an approval covers one revision: a later publish puts the proposal back to ready, keeps the approved revision, tells the implementer, and the revisions can be read back", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author);
    const approved = await service.approve(PROJECT, ORG, n, BOSS);
    expect(approved).toMatchObject({ status: "approved", revision: 1, approvedRevision: 1 });
    expect(approved.events.at(-1)).toMatchObject({ kind: "approved", revision: 1 });

    const revised = await service.publish(
      PROJECT,
      ORG,
      n,
      DOC.replace("One sweep", "Two sweeps"),
      author,
    );
    expect(revised).toMatchObject({ status: "ready", revision: 2, approvedRevision: 1 });
    expect(revised.events.at(-1)).toMatchObject({
      kind: "ready",
      text: "revision 2 — approval of revision 1 no longer covers it",
    });
    expect(gateway.desks.at(-1)).toEqual({
      agentId: "acme_impl",
      text: `[proposal #${n}] revised after approval (revision 1 → 2) — wait for a new approval before merging.`,
    });
    // The implementer may not merge on the old approval.
    expect(await refused(() => service.merged(PROJECT, ORG, n, impl))).toEqual({
      status: 409,
      code: "proposal_status",
    });
    // Approving again covers the head.
    const again = await service.approve(PROJECT, ORG, n, BOSS);
    expect(again).toMatchObject({ status: "approved", approvedRevision: 2 });

    // Every revision as published, and one of them in full.
    const listing = await service.revisions(PROJECT, ORG, n, BOSS);
    expect(listing.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(listing.revisions[0]).toMatchObject({ by: "agent:acme_dev" });
    const first = await service.revision(PROJECT, ORG, n, 1, BOSS);
    expect(first.revision).toBe(1);
    expect(sectionSource(first.sections[1]!)).toContain("One sweep");
    const second = await service.revision(PROJECT, ORG, n, 2, BOSS);
    expect(sectionSource(second.sections[1]!)).toContain("Two sweeps");
    expect(await refused(() => service.revision(PROJECT, ORG, n, 9, BOSS))).toEqual({
      status: 404,
      code: "revision_not_found",
    });
    // Replayed from the file, the same facts stand.
    const replay = newService({
      ...offline(),
      gateway,
      root,
      log: { line: () => {} },
      agents,
    });
    expect(await replay.get(PROJECT, ORG, n, BOSS)).toMatchObject({
      status: "approved",
      approvedRevision: 2,
    });
  });

  it("unread counts what happened since the reader's position, never their own doing — a person's or an employee's", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    let list = await service.list(PROJECT, ORG, BOSS);
    expect(list.proposals[0]).toMatchObject({ number: n, unread: 2 });
    // The author has a position of its own: the person's delegation is what it has not read.
    expect((await service.list(PROJECT, ORG, author)).proposals[0]!.unread).toBe(1);
    await service.read(PROJECT, ORG, n, (await service.get(PROJECT, ORG, n, author)).seq, author);
    expect((await service.list(PROJECT, ORG, author)).proposals[0]!.unread).toBe(0);
    expect(storeOf(root, (s) => s.readSeq("agent:acme_dev", n))).toBeGreaterThan(0);

    const detail = await service.get(PROJECT, ORG, n, BOSS);
    await service.read(PROJECT, ORG, n, detail.seq, BOSS);
    expect((await service.list(PROJECT, ORG, BOSS)).proposals[0]!.unread).toBe(0);
    await service.approve(PROJECT, ORG, n, BOSS);
    expect((await service.list(PROJECT, ORG, BOSS)).proposals[0]!.unread).toBe(0);
    await service.feedback(PROJECT, ORG, n, { text: "note" }, author);
    list = await service.list(PROJECT, ORG, BOSS);
    expect(list.proposals[0]!.unread).toBe(1);
    // The position never moves back.
    await service.read(PROJECT, ORG, n, 1, BOSS);
    expect((await service.list(PROJECT, ORG, BOSS)).proposals[0]!.unread).toBe(1);
    expect(storeOf(root, (s) => s.readSeq("boss", n))).toBe(detail.seq);
    // The person's reading moved nothing of the author's: the approval is unread to it, its own feedback is not.
    expect((await service.list(PROJECT, ORG, author)).proposals[0]!.unread).toBe(1);
  });

  it("a pending comment is its writer's to reword or withdraw; sent, or someone else's, it is not", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    const published = await service.get(PROJECT, ORG, n, BOSS);
    const change = published.sections[0]!;
    const start = sectionSource(change).indexOf("notifyTicket");
    const range = {
      sectionId: change.id,
      start,
      end: start + "notifyTicket".length,
      quote: "notifyTicket",
    };
    let detail = await service.comment(PROJECT, ORG, n, { ...range, text: "first words" }, BOSS);
    const [c] = detail.comments;
    detail = await service.editComment(PROJECT, ORG, n, c!.id, "  better words  ", BOSS);
    expect(detail.comments.find((x) => x.id === c!.id)?.text).toBe("better words");
    expect(
      await refused(() => service.editComment(PROJECT, ORG, n, c!.id, " ", BOSS)),
    ).toMatchObject({
      status: 400,
    });
    // Another person, and the employee, cannot touch it; a comment that is not there is 404.
    expect(
      await refused(() => service.editComment(PROJECT, ORG, n, c!.id, "mine now", OUTSIDER)),
    ).toEqual({
      status: 403,
      code: "project_access",
    });
    expect(await refused(() => service.deleteComment(PROJECT, ORG, n, "nope", BOSS))).toEqual({
      status: 404,
      code: "comment_not_found",
    });
    // A second person of the Project is not the writer either.
    gateway.org!.userIds = ["boss", "cfo"];
    expect(
      await refused(() => service.deleteComment(PROJECT, ORG, n, c!.id, { userId: "cfo" })),
    ).toEqual({ status: 403, code: "not_commenter" });
    // Withdrawn: gone from the person's view, and the pending count with it.
    detail = await service.deleteComment(PROJECT, ORG, n, c!.id, BOSS);
    expect(detail.comments).toEqual([]);
    expect(detail.pendingComments).toBe(0);
    // Sent, a comment stands as the author read it.
    detail = await service.comment(PROJECT, ORG, n, { ...range, text: "sent words" }, BOSS);
    const sent = detail.comments[0]!;
    await service.requestChanges(PROJECT, ORG, n, BOSS);
    expect(
      await refused(() => service.editComment(PROJECT, ORG, n, sent.id, "too late", BOSS)),
    ).toEqual({
      status: 409,
      code: "comment_sent",
    });
    expect(await refused(() => service.deleteComment(PROJECT, ORG, n, sent.id, BOSS))).toEqual({
      status: 409,
      code: "comment_sent",
    });
    // A new service over the same store reads the same view.
    const again = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
    });
    const replayed = await again.get(PROJECT, ORG, n, BOSS);
    expect(replayed.comments.map((x) => [x.id, x.text, x.batchId !== null])).toEqual([
      [sent.id, "sent words", true],
    ]);
  });

  it("the brief is rewritten in place by any member: revisions, comments and approval stand, the author is told only while drafting", async () => {
    const n = await delegated();
    gateway.desks.length = 0;
    // A person rewrites a drafting proposal's brief: the author is told, the event carries the new brief.
    let detail = await service.editBrief(PROJECT, ORG, n, "  Batch the ticket notices  ", BOSS);
    expect(detail.brief).toBe("Batch the ticket notices");
    expect(detail.events.at(-1)).toMatchObject({
      kind: "brief_edited",
      by: "user:boss",
      text: "Batch the ticket notices",
    });
    expect(gateway.desks).toEqual([
      {
        agentId: "acme_dev",
        text: `[proposal #${n}] boss rewrote the brief: Batch the ticket notices\n\nRead it with \`penguin org proposal show ${n}\` before the next revision.`,
      },
    ]);
    expect(gateway.events.at(-1)).toMatchObject({
      type: "plugin",
      data: { number: n, kind: "brief_edited", seq: detail.seq },
    });
    // The author rewrites its own: not told of its own act.
    detail = await service.editBrief(PROJECT, ORG, n, "Batch the notices, once per sweep", author);
    expect(detail.events.at(-1)).toMatchObject({ kind: "brief_edited", by: "agent:acme_dev" });
    expect(gateway.desks).toHaveLength(1);
    // No empty brief, no rewrite to the same words — whoever asks — no proposal that is not there.
    expect(
      await refused(() =>
        service.editBrief(PROJECT, ORG, n, "Batch the notices, once per sweep", qa),
      ),
    ).toEqual({ status: 409, code: "brief_unchanged" });
    expect(await refused(() => service.editBrief(PROJECT, ORG, n, "  ", BOSS))).toEqual({
      status: 400,
      code: "bad_request",
    });
    expect(
      await refused(() =>
        service.editBrief(PROJECT, ORG, n, " Batch the notices, once per sweep ", BOSS),
      ),
    ).toEqual({ status: 409, code: "brief_unchanged" });
    expect(await refused(() => service.editBrief(PROJECT, ORG, 99, "x", BOSS))).toEqual({
      status: 404,
      code: "proposal_not_found",
    });
    // Past drafting it is still allowed — the brief is what the queue shows, not what was
    // approved — and the author's desk is left alone.
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.approve(PROJECT, ORG, n, BOSS);
    const desks = gateway.desks.length;
    detail = await service.editBrief(PROJECT, ORG, n, "Batched ticket notices", BOSS);
    expect(detail).toMatchObject({
      brief: "Batched ticket notices",
      status: "approved",
      revision: 1,
      approvedRevision: 1,
      title: "Batch the ticket notices",
    });
    expect(gateway.desks).toHaveLength(desks);
    // A new service over the same store reads the same brief.
    const again = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
    });
    expect((await again.get(PROJECT, ORG, n, BOSS)).brief).toBe("Batched ticket notices");
    expect((await again.list(PROJECT, ORG, BOSS)).proposals[0]?.title).toBe(
      "Batch the ticket notices",
    );
  });

  it("proposal.brief rewrites the brief with the caller's identity; a missing brief is a 400", async () => {
    const n = await delegated();
    const { run } = routes();
    const ok = await run(
      "proposal.brief",
      `proposal:${n}`,
      { brief: "Batch the ticket notices" },
      author,
    );
    expect(ok.status).toBe(200);
    const detail = (await ok.json()) as {
      brief: string;
      events: Array<{ kind: string; by: string }>;
    };
    expect(detail.brief).toBe("Batch the ticket notices");
    expect(detail.events.at(-1)).toMatchObject({ kind: "brief_edited", by: "agent:acme_dev" });
    const missing = await run("proposal.brief", `proposal:${n}`, {});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "bad_params", message: "Missing parameter: brief (string)." },
    });
    // Any member rewrites it, not only the author: the event says who.
    const other = await run("proposal.brief", `proposal:${n}`, { brief: "Theirs now" }, qa);
    expect(other.status).toBe(200);
    expect(((await other.json()) as { events: Array<{ by: string }> }).events.at(-1)).toMatchObject(
      { by: "agent:acme_qa" },
    );
  });

  it("a desk that refuses never fails the write: the store has the event, the log has the reason", async () => {
    gateway.refuse.set(
      "acme_dev",
      "acme_dev is paused by its budget for 2026-09; it was not told.",
    );
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_dev", brief: "Still recorded" },
      BOSS,
    );
    expect(created.number).toBe(1);
    expect(gateway.desks).toEqual([]);
    expect(
      lines.some((l) => l.includes("not notified") && l.includes("paused by its budget")),
    ).toBe(true);
    // Not silent: the answer carries it, and the timeline records it.
    const reason =
      "agent:acme_dev not notified: acme_dev is paused by its budget for 2026-09; it was not told.";
    expect(created.hints).toEqual([reason]);
    const read = await service.get(PROJECT, ORG, created.number, BOSS);
    expect(read.events.map((e) => e.kind)).toEqual(["created", "notify_failed"]);
    expect(read.events[1]).toMatchObject({ text: reason, by: "user:boss" });
  });

  it("a request for changes that cannot reach the author is recorded as a failed delivery", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    const detail = await service.get(PROJECT, ORG, n, BOSS);
    const change = detail.sections[0]!;
    const source = sectionSource(change);
    const start = source.indexOf("notifyTicket");
    await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: change.id, start, end: start + 12, quote: "notifyTicket", text: "why?" },
      BOSS,
    );
    gateway.refuse.set("acme_dev", "Acme is paused; acme_dev was not told.");
    const requested = await service.requestChanges(PROJECT, ORG, n, BOSS);
    expect(requested.hints).toEqual([
      "agent:acme_dev not notified: Acme is paused; acme_dev was not told.",
    ]);
    expect(requested.events.at(-1)?.kind).toBe("notify_failed");
  });

  it("stands again from the file: a new service over the same root sees the same proposals", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    const again = newService({
      ...offline(),
      gateway,
      agents,
      root,
      log,
    });
    const replayed = await again.get(PROJECT, ORG, n, BOSS);
    expect(replayed).toEqual(await service.get(PROJECT, ORG, n, BOSS));
    expect(replayed.status).toBe("ready");
  });

  it("slugs a title for the branch name", () => {
    expect(slugOf("Batch the ticket notices, once per sweep!")).toBe(
      "batch-the-ticket-notices-once-per",
    );
    expect(slugOf("工单通知批量送达")).toBe("proposal");
  });
});

describe("the declared test groups", () => {
  it("reads `id: description` lines in order, skipping a malformed or repeated one", () => {
    expect(testGroupsOf({}).groups.map((g) => g.id)).toEqual([
      "unit",
      "integration",
      "e2e",
      "bench",
    ]);
    expect(
      testGroupsOf({
        testGroups: ["e2e: whole product", "Perf timings", "e2e: again", "unit: one module"],
      }),
    ).toEqual({
      groups: [
        { id: "e2e", description: "whole product" },
        { id: "unit", description: "one module" },
      ],
      skipped: ["Perf timings", "e2e: again"],
    });
    expect(testGroupsOf({ testGroups: [] }).groups).toEqual([]);
  });
});

describe("the manifest", () => {
  it("agrees with the code half: the generated table names the routes, the page and the modules", () => {
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { contributes: Record<string, Array<{ id: string; nav?: string }>> }>;
      plugin: { modules: string[] };
    };
    expect(plugin.modules).toEqual([
      CompanyProposalsPlugin,
      ProposalNotices,
      CompanyActionRegistry,
      ProposalsRetirement,
    ]);
    expect(table.plugin.modules).toEqual([
      "CompanyProposalsPlugin",
      "ProposalNotices",
      "CompanyActionRegistry",
      "ProposalsRetirement",
    ]);
    expect(table.modules.CompanyActionRegistry?.contributes["HttpModule.routes"]?.[0]?.id).toBe(
      ACTION_ROUTES_ID,
    );
    const retirement = table.modules.ProposalsRetirement;
    expect(retirement?.contributes["OrganizationModule.retirements"]?.[0]?.id).toBe(RETIRE_ID);
    // The retirement node must not require what the organization module provides: that is a cycle.
    expect(JSON.stringify(retirement)).not.toContain("CompanyModule");
    const manifest = table.modules.CompanyProposalsPlugin;
    expect(manifest?.contributes["HttpModule.routes"]?.[0]?.id).toBe(ROUTES_ID);
    expect(manifest?.contributes["WebModule.pages"]?.[0]).toMatchObject({
      id: PAGE_ID,
      nav: "org",
    });
  });

  it("declares the settings group config.ts reads: the same id, line pattern and defaults", () => {
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { contributes: Record<string, unknown[]> }>;
    };
    const [group] = (table.modules.CompanyProposalsPlugin?.contributes[
      "PluginConfigProvider.groups"
    ] ?? []) as Array<{
      id: string;
      properties: { testGroups: { type: string; pattern: string; default: string[] } };
    }>;
    expect(group?.id).toBe(CONFIG_GROUP);
    expect(group?.properties.testGroups).toMatchObject({
      type: "list",
      pattern: TEST_GROUP_LINE,
      default: [...DEFAULT_TEST_GROUPS],
    });
  });
});

describe("withImplPr", () => {
  const impl = {
    url: "https://github.com/acme/site/pull/7",
    label: "acme/site#7",
    by: "user:admin",
    at: "2026-10-01T00:00:00.000Z",
  };

  it("lists an impl PR no material holds first, as a pr material", () => {
    const other = {
      kind: "doc" as const,
      label: "spec",
      url: "https://example.com/spec",
      by: "user:a",
      at: "t",
    };
    expect(withImplPr([other], impl)).toEqual([
      { kind: "pr", label: "acme/site#7", url: impl.url, by: "user:admin", at: impl.at },
      other,
    ]);
  });

  it("adds nothing when a pr material is already that pull request, or there is no impl PR", () => {
    const held = {
      kind: "pr" as const,
      label: "PR #7",
      url: "https://github.com/acme/site/pull/7/files",
      by: "user:a",
      at: "t",
    };
    expect(withImplPr([held], impl)).toEqual([held]);
    expect(withImplPr([], null)).toEqual([]);
  });
});
