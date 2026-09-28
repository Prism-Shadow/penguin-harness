/**
 * The service over a fake organization gateway: the whole lifecycle of a proposal — a
 * person delegates, the author publishes and marks ready, comments gather and go out as
 * one batch, the author resolves, an implementer's session opens, feedback, approval,
 * merge — every drive of an employee being one `[proposal #<n>]` line on its desk, in
 * nobody's name and never to the employee that acted, every refusal the right one, pending comments invisible to employees,
 * unread counts moving with a person's read position, and the whole thing standing again
 * after the ledger is replayed. Nothing here starts a server or a Session.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import plugin, {
  sectionSource,
  CompanyProposalsPlugin,
  PAGE_ID,
  ProposalError,
  ProposalService,
  ROUTES_ID,
  CONFIG_GROUP,
  DEFAULT_TEST_GROUPS,
  TEST_GROUP_LINE,
  ledgerPath,
  proposalRoutes,
  slugOf,
  testGroupsOf,
} from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";

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
}

/** `gh` as the service sees it: every pull request asked about is merged; the arguments asked are recorded. */
const githubCalls: string[][] = [];
const githubGh: RunGh = async (args) => {
  githubCalls.push([...args]);
  return JSON.stringify({ state: "closed", merged: true, merged_at: "2026-09-23T00:00:00Z" });
};

class FakeSettings {
  readonly values = new Map<string, string>();
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
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
  let settings: FakeSettings;
  let service: ProposalService;
  const lines: string[] = [];
  const log = { line: (l: string) => lines.push(l) };

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
    settings = new FakeSettings();
    lines.length = 0;
    githubCalls.length = 0;
    service = new ProposalService({ gateway, agents, root, settings, log, gh: githubGh });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function delegated(): Promise<number> {
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_dev", brief: "Batch the notices" },
      BOSS,
    );
    return created.number;
  }

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
    service = new ProposalService({ gateway, agents, root, settings, log, gh: githubGh });
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

  it("an employee proposes on its own: it is the author and the delegator, and its own desk is not told", async () => {
    const created = await service.create(PROJECT, ORG, { brief: "Rotate the API token" }, author);
    expect(created).toMatchObject({
      number: 1,
      author: "acme_dev",
      delegatedBy: "agent:acme_dev",
      status: "drafting",
    });
    expect(created.events[0]).toMatchObject({ kind: "created", by: "agent:acme_dev" });
    // Telling it of its own act would only start a run on its own desk.
    expect(gateway.desks).toEqual([]);
    expect(agents.updates).toEqual(["acme_dev"]);
    // Delegating to a colleague: the colleague is the author and its desk is told.
    const handed = await service.create(
      PROJECT,
      ORG,
      { author: "acme_impl", brief: "Split the sweep" },
      author,
    );
    expect(handed).toMatchObject({ number: 2, author: "acme_impl", delegatedBy: "agent:acme_dev" });
    expect(gateway.desks).toEqual([
      { agentId: "acme_impl", text: expect.stringMatching(/^\[proposal #2\] acme_dev asks you/) },
    ]);
    expect(agents.updates).toEqual(["acme_dev", "acme_impl"]);
    // A person sees the employee's proposal as unread; the employee counts nothing.
    const seen = await service.get(PROJECT, ORG, 1, BOSS);
    expect(seen.unread).toBe(1);
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

  it("the author publishes, marks ready, and nobody else but a person may", async () => {
    const n = await delegated();
    expect(await refused(() => service.ready(PROJECT, ORG, n, author))).toEqual({
      status: 409,
      code: "proposal_empty",
    });
    expect(await refused(() => service.publish(PROJECT, ORG, n, DOC, impl))).toEqual({
      status: 403,
      code: "not_author",
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
    const configured = new ProposalService({
      gateway,
      agents,
      root,
      settings,
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

  it("a revision written before tests existed reads with no tests", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    const again = new ProposalService({ gateway, root, settings, agents, log: { line: () => {} } });
    const read = await again.get(PROJECT, ORG, n, BOSS);
    expect(read.tests).toEqual([]);
    const text = await fs.readFile(ledgerPath(root, PROJECT, ORG), "utf8");
    expect(text).not.toContain('"tests"');
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

  it("a person may mark ready past unanswered changes", async () => {
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
    expect((await service.ready(PROJECT, ORG, n, BOSS)).status).toBe("ready");
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
        service.comment(PROJECT, ORG, n, { sectionId: change.id, ...first, text: "x" }, author),
      ),
    ).toEqual({
      status: 403,
      code: "person_required",
    });
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
    expect(
      await refused(() => service.resolve(PROJECT, ORG, n, firstComment!.id, "done", impl)),
    ).toEqual({
      status: 403,
      code: "not_author",
    });
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
      await refused(() => service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, impl)),
    ).toEqual({
      status: 403,
      code: "not_author",
    });
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
      // The ledger replays to the same discussions.
      const again = new ProposalService({ gateway, agents, root, settings, log });
      expect((await again.get(PROJECT, ORG, n, BOSS)).discussions).toEqual(
        (await service.get(PROJECT, ORG, n, BOSS)).discussions,
      );
    });

    it("only a person or the discussion's own session concludes it", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const { sessionId } = await service.discuss(PROJECT, ORG, n, BOSS);
      const before = gateway.desks.length;
      // The owner's desk is the same Agent, but not the discussion.
      expect(
        await refused(() => service.conclude(PROJECT, ORG, n, sessionId, "x", author)),
      ).toEqual({
        status: 403,
        code: "not_discussion",
      });
      expect(
        await refused(() =>
          service.conclude(PROJECT, ORG, n, sessionId, "x", inside("acme_qa", sessionId)),
        ),
      ).toEqual({ status: 403, code: "not_discussion" });
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
      // A person may conclude it from the outside.
      await service.conclude(PROJECT, ORG, n, sessionId, "Agreed.", BOSS);
      expect(gateway.desks.slice(before).map((d) => d.agentId)).toEqual(["acme_dev"]);
    });

    it("refuses a discussion nobody can hold", async () => {
      const n = await delegated();
      // An employee does not open one: the button is a person's.
      expect(await refused(() => service.discuss(PROJECT, ORG, n, author))).toEqual({
        status: 403,
        code: "person_required",
      });
      gateway.org!.status = "paused";
      expect(await refused(() => service.discuss(PROJECT, ORG, n, BOSS))).toEqual({
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

    it("POST /:number/discussions opens one; POST …/:sessionId/conclude carries the session's identity", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const app = new Hono();
      let via = "password";
      app.use(async (c, next) => {
        c.set("user" as never, { userId: "boss" } as never);
        c.set("sessionVia" as never, via as never);
        await next();
      });
      app.route("/p/:projectId/o/:orgId/proposals", proposalRoutes(service));
      const post = (suffix: string, body?: unknown) =>
        app.request(`/p/${PROJECT}/o/${ORG}/proposals/${n}${suffix}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      const opened = await post("/discussions");
      expect(opened.status).toBe(201);
      const { sessionId } = (await opened.json()) as { sessionId: string };
      expect(sessionId).toBe("impl-1");
      const missing = await post(`/discussions/${sessionId}/conclude`, {});
      expect(missing.status).toBe(400);
      // Behind the local API token the session claim counts: the desk's is refused, the discussion's own is honoured.
      via = "token";
      const desk = await post(`/discussions/${sessionId}/conclude`, {
        text: "x",
        agentId: "acme_dev",
        sessionId: "desk-dev",
      });
      expect(desk.status).toBe(403);
      const ok = await post(`/discussions/${sessionId}/conclude`, {
        text: "Agreed.",
        agentId: "acme_dev",
        sessionId,
      });
      expect(ok.status).toBe(200);
      const detail = (await ok.json()) as {
        discussions: Array<{ concluded: { by: string } | null }>;
      };
      expect(detail.discussions[0]!.concluded).toMatchObject({ by: "agent:acme_dev" });
      expect(gateway.desks.filter((d) => d.text.includes("concluded (session"))).toHaveLength(1);
    });
  });

  it("materials, feedback and runtime feedback: the author is told, runtime feedback tells the implementer too", async () => {
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
    // The write's answer carries no status; a READ asks GitHub (the injected gh) and adds it.
    expect(withPr.materials[0]!.status).toBeUndefined();
    const read = await service.get(PROJECT, ORG, n, BOSS);
    expect(read.materials[0]).toMatchObject({ status: "merged" });
    expect(typeof read.materials[0]!.statusCheckedAt).toBe("string");
    expect(githubCalls).toEqual([["api", "repos/x/y/pulls/42"]]);
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

  it("approve, merge and reject: who may, from which status, and who is told", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    expect(await refused(() => service.approve(PROJECT, ORG, n, author))).toEqual({
      status: 403,
      code: "person_required",
    });
    expect(await refused(() => service.merged(PROJECT, ORG, n, impl))).toEqual({
      status: 403,
      code: "not_implementer",
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
    expect(await refused(() => service.merged(PROJECT, ORG, m, author))).toEqual({
      status: 403,
      code: "not_implementer",
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

  describe("withdraw", () => {
    /** The refusal with its message, for the one place the words are the point. */
    async function refusal(run: () => Promise<unknown>): Promise<ProposalError> {
      try {
        await run();
      } catch (err) {
        if (err instanceof ProposalError) return err;
        throw err;
      }
      throw new Error("expected a refusal");
    }

    it("the author or a person withdraws; another employee, and an implementer that is not the author, may not", async () => {
      // A rev-0 draft of the author's own: nothing published, nobody else to tell.
      const own = (await service.create(PROJECT, ORG, { brief: "Not needed after all" }, author))
        .number;
      const desks = gateway.desks.length;
      const mine = await service.withdraw(PROJECT, ORG, own, undefined, author);
      expect(mine).toMatchObject({ number: own, status: "withdrawn", revision: 0 });
      expect(mine.events.at(-1)).toEqual(
        expect.objectContaining({ kind: "withdrawn", by: "agent:acme_dev" }),
      );
      expect(mine.events.at(-1)).not.toHaveProperty("text");
      expect(gateway.desks).toHaveLength(desks);

      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      await service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author);
      expect(await refused(() => service.withdraw(PROJECT, ORG, n, undefined, qa))).toEqual({
        status: 403,
        code: "not_author",
      });
      expect(await refused(() => service.withdraw(PROJECT, ORG, n, undefined, impl))).toEqual({
        status: 403,
        code: "not_author",
      });
      const byPerson = await service.withdraw(PROJECT, ORG, n, "  Folded into #24.  ", BOSS);
      expect(byPerson.status).toBe("withdrawn");
      expect(byPerson.events.at(-1)).toMatchObject({
        kind: "withdrawn",
        by: "user:boss",
        text: "Folded into #24.",
      });
      expect(gateway.desks.slice(-2)).toEqual([
        {
          agentId: "acme_dev",
          text: `[proposal #${n}] withdrawn by boss: Folded into #24. — stop work on it, and close its PR if one is open.`,
        },
        {
          agentId: "acme_impl",
          text: `[proposal #${n}] withdrawn by boss: Folded into #24. — stop work on it, and close its PR if one is open.`,
        },
      ]);
    });

    it("the author's own withdrawal tells the implementer only, and counts as unread for a person", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      await service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author);
      const seen = await service.get(PROJECT, ORG, n, BOSS);
      await service.read(PROJECT, ORG, n, seen.seq, BOSS);
      const desks = gateway.desks.length;
      // A blank reason is no reason.
      await service.withdraw(PROJECT, ORG, n, "  ", author);
      expect(gateway.desks.slice(desks)).toEqual([
        {
          agentId: "acme_impl",
          text: `[proposal #${n}] withdrawn by acme_dev — stop work on it, and close its PR if one is open.`,
        },
      ]);
      expect((await service.list(PROJECT, ORG, BOSS)).proposals[0]).toMatchObject({
        number: n,
        status: "withdrawn",
        unread: 1,
      });
    });

    it("only while drafting: ready, approved, merged, rejected and withdrawn are 409, and a ready one says to ask for a reject", async () => {
      const ready = await delegated();
      await service.publish(PROJECT, ORG, ready, DOC, author);
      await service.ready(PROJECT, ORG, ready, author);
      const err = await refusal(() => service.withdraw(PROJECT, ORG, ready, undefined, author));
      expect({ status: err.status, code: err.code }).toEqual({
        status: 409,
        code: "proposal_status",
      });
      expect(err.message).toContain("is ready");
      expect(err.message).toContain("only while drafting");
      expect(err.message).toContain("reject");
      // A person may not withdraw a ready one either: that is what reject is for.
      expect(await refused(() => service.withdraw(PROJECT, ORG, ready, undefined, BOSS))).toEqual({
        status: 409,
        code: "proposal_status",
      });

      const approved = await delegated();
      await service.publish(PROJECT, ORG, approved, DOC, author);
      await service.implement(PROJECT, ORG, approved, { agentId: "acme_impl" }, author);
      await service.approve(PROJECT, ORG, approved, BOSS);
      expect(
        await refused(() => service.withdraw(PROJECT, ORG, approved, undefined, author)),
      ).toEqual({ status: 409, code: "proposal_status" });
      await service.merged(PROJECT, ORG, approved, impl);
      expect(
        await refused(() => service.withdraw(PROJECT, ORG, approved, undefined, author)),
      ).toEqual({ status: 409, code: "proposal_status" });

      const rejected = await delegated();
      await service.reject(PROJECT, ORG, rejected, "No.", BOSS);
      expect(
        await refused(() => service.withdraw(PROJECT, ORG, rejected, undefined, author)),
      ).toEqual({ status: 409, code: "proposal_status" });

      const twice = await delegated();
      await service.withdraw(PROJECT, ORG, twice, undefined, author);
      expect(await refused(() => service.withdraw(PROJECT, ORG, twice, undefined, author))).toEqual(
        { status: 409, code: "proposal_status" },
      );
    });

    it("a request for changes puts a ready proposal back to drafting, and then the author may withdraw it", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      await service.ready(PROJECT, ORG, n, author);
      const change = (await service.get(PROJECT, ORG, n, BOSS)).sections[0]!;
      const start = sectionSource(change).indexOf("notifyTicket");
      await service.comment(
        PROJECT,
        ORG,
        n,
        { sectionId: change.id, start, end: start + 12, quote: "notifyTicket", text: "why?" },
        BOSS,
      );
      await service.requestChanges(PROJECT, ORG, n, BOSS);
      expect((await service.withdraw(PROJECT, ORG, n, "Superseded.", author)).status).toBe(
        "withdrawn",
      );
    });

    it("a withdrawn proposal is closed: no publish (and no scope check), no implementation, discussion, reject, ready or approve — and it is still listed and readable", async () => {
      const n = await delegated();
      await service.publish(PROJECT, ORG, n, DOC, author);
      const before = await service.get(PROJECT, ORG, n, BOSS);
      // The detail shares the live arrays: keep what the events were, not a view of them.
      const kindsBefore = before.events.map((e) => e.kind);
      await service.withdraw(PROJECT, ORG, n, undefined, author);
      // A scope naming a file that is not there would be a 400 scope_missing if the check ran.
      const badScope = DOC.replace(
        "packages/server/src/runtime/organization/reconcile.ts",
        "no/such/file.ts",
      );
      expect(await refused(() => service.publish(PROJECT, ORG, n, badScope, author))).toEqual({
        status: 409,
        code: "proposal_closed",
      });
      const closed = { status: 409, code: "proposal_status" };
      expect(
        await refused(() => service.implement(PROJECT, ORG, n, { agentId: "acme_impl" }, author)),
      ).toEqual(closed);
      expect(await refused(() => service.discuss(PROJECT, ORG, n, BOSS))).toEqual(closed);
      expect(await refused(() => service.reject(PROJECT, ORG, n, "Too late.", BOSS))).toEqual(
        closed,
      );
      expect(await refused(() => service.ready(PROJECT, ORG, n, author))).toEqual(closed);
      expect(await refused(() => service.approve(PROJECT, ORG, n, BOSS))).toEqual(closed);

      const listed = (await service.list(PROJECT, ORG, BOSS)).proposals;
      expect(listed.map((p) => [p.number, p.status])).toEqual([[n, "withdrawn"]]);
      const after = await service.get(PROJECT, ORG, n, BOSS);
      expect(after).toMatchObject({ status: "withdrawn", revision: 1 });
      expect(after.sections).toEqual(before.sections);
      expect(after.scope).toEqual(before.scope);
      expect(after.pendingComments).toBe(before.pendingComments);
      expect(after.events.map((e) => e.kind)).toEqual([...kindsBefore, "withdrawn"]);
    });

    it("POST /:number/withdraw: no body, {} and { reason } all withdraw; a reason too long is a 400; 403 and 409 carry their codes", async () => {
      const app = new Hono();
      app.use(async (c, next) => {
        c.set("user" as never, { userId: "boss" } as never);
        c.set("sessionVia" as never, "token" as never);
        await next();
      });
      app.route("/p/:projectId/o/:orgId/proposals", proposalRoutes(service));
      const post = (n: number, body?: unknown) =>
        app.request(`/p/${PROJECT}/o/${ORG}/proposals/${n}/withdraw`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      const a = await delegated();
      const b = await delegated();
      const c = await delegated();
      const d = await delegated();

      const bare = await post(a);
      expect(bare.status).toBe(200);
      expect(((await bare.json()) as { status: string }).status).toBe("withdrawn");
      expect((await post(b, {})).status).toBe(200);
      const withReason = await post(c, { reason: "Not needed.", agentId: "acme_dev" });
      expect(withReason.status).toBe(200);
      const detail = (await withReason.json()) as {
        events: Array<{ kind: string; by: string; text?: string }>;
      };
      expect(detail.events.at(-1)).toMatchObject({
        kind: "withdrawn",
        by: "agent:acme_dev",
        text: "Not needed.",
      });

      const tooLong = await post(d, { reason: "x".repeat(4001) });
      expect(tooLong.status).toBe(400);
      expect(((await tooLong.json()) as { error: { code: string } }).error.code).toBe(
        "bad_request",
      );
      const other = await post(d, { agentId: "acme_qa" });
      expect(other.status).toBe(403);
      expect(((await other.json()) as { error: { code: string } }).error.code).toBe("not_author");
      const again = await post(a);
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
        "proposal_status",
      );
    });
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
    const replay = new ProposalService({
      gateway,
      root,
      settings,
      log: { line: () => {} },
      agents,
    });
    expect(await replay.get(PROJECT, ORG, n, BOSS)).toMatchObject({
      status: "approved",
      approvedRevision: 2,
    });
  });

  it("unread counts what happened since the person's read position, never their own doing; employees count nothing", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    let list = await service.list(PROJECT, ORG, BOSS);
    expect(list.proposals[0]).toMatchObject({ number: n, unread: 2 });
    expect((await service.list(PROJECT, ORG, author)).proposals[0]!.unread).toBe(0);

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
    expect(settings.values.get("company-proposals:reads:proj/acme/boss")).toBe(
      JSON.stringify({ [n]: detail.seq }),
    );
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
    // The ledger replays to the same view.
    const again = new ProposalService({ gateway, agents, root, settings, log });
    const replayed = await again.get(PROJECT, ORG, n, BOSS);
    expect(replayed.comments.map((x) => [x.id, x.text, x.batchId !== null])).toEqual([
      [sent.id, "sent words", true],
    ]);
  });

  it("the brief is rewritten in place by the author or a person: revisions, comments and approval stand, the author is told only while drafting", async () => {
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
    // Nobody else, no empty brief, no rewrite to the same words, no proposal that is not there.
    expect(await refused(() => service.editBrief(PROJECT, ORG, n, "Mine now", qa))).toEqual({
      status: 403,
      code: "not_author",
    });
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
    // The ledger replays to the same brief.
    const again = new ProposalService({ gateway, agents, root, settings, log });
    expect((await again.get(PROJECT, ORG, n, BOSS)).brief).toBe("Batched ticket notices");
    expect((await again.list(PROJECT, ORG, BOSS)).proposals[0]?.title).toBe(
      "Batch the ticket notices",
    );
  });

  it("PUT /:number/brief rewrites the brief with the caller's identity; a missing brief is a 400", async () => {
    const n = await delegated();
    const app = new Hono();
    app.use(async (c, next) => {
      c.set("user" as never, { userId: "boss" } as never);
      c.set("sessionVia" as never, "token" as never);
      await next();
    });
    app.route("/p/:projectId/o/:orgId/proposals", proposalRoutes(service));
    const put = (body: unknown) =>
      app.request(`/p/${PROJECT}/o/${ORG}/proposals/${n}/brief`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const ok = await put({ brief: "Batch the ticket notices", agentId: "acme_dev" });
    expect(ok.status).toBe(200);
    const detail = (await ok.json()) as {
      brief: string;
      events: Array<{ kind: string; by: string }>;
    };
    expect(detail.brief).toBe("Batch the ticket notices");
    expect(detail.events.at(-1)).toMatchObject({ kind: "brief_edited", by: "agent:acme_dev" });
    const missing = await put({});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: { code: "bad_request", message: "brief must be a non-empty string." },
    });
    const other = await put({ brief: "Not mine", agentId: "acme_qa" });
    expect(other.status).toBe(403);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe("not_author");
  });

  it("a desk that refuses never fails the write: the ledger has the line, the log has the reason", async () => {
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
    const again = new ProposalService({ gateway, agents, root, settings, log });
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
  it("agrees with the code half: the generated table names the routes, the page and the module", () => {
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { contributes: Record<string, Array<{ id: string; nav?: string }>> }>;
      plugin: { modules: string[] };
    };
    expect(plugin.modules).toEqual([CompanyProposalsPlugin]);
    expect(table.plugin.modules).toEqual(["CompanyProposalsPlugin"]);
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
