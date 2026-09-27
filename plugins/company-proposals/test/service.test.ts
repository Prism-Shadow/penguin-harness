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
  slugOf,
  testGroupsOf,
} from "../src/index.js";

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
    if (refused !== undefined) throw new Error(refused);
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

/** GitHub as the service sees it: every pull request asked about is merged; the URLs asked are recorded. */
const githubCalls: string[] = [];
const githubFetch = (async (input: string | URL | Request) => {
  githubCalls.push(String(input));
  return new Response(
    JSON.stringify({ state: "closed", merged: true, merged_at: "2026-09-23T00:00:00Z" }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}) as unknown as typeof fetch;

class FakeSettings {
  readonly values = new Map<string, string>();
  githubToken: string | null = null;
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
  getGithubToken(): string | null {
    return this.githubToken;
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
    service = new ProposalService({ gateway, agents, root, settings, log, fetch: githubFetch });
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
    service = new ProposalService({ gateway, agents, root, settings, log, fetch: githubFetch });
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
    // The write's answer carries no status; a READ asks GitHub (the injected fetch) and adds it.
    expect(withPr.materials[0]!.status).toBeUndefined();
    const read = await service.get(PROJECT, ORG, n, BOSS);
    expect(read.materials[0]).toMatchObject({ status: "merged" });
    expect(typeof read.materials[0]!.statusCheckedAt).toBe("string");
    expect(githubCalls).toEqual(["https://api.github.com/repos/x/y/pulls/42"]);
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
