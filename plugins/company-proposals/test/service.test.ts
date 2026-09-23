/**
 * The service over a fake organization gateway: the whole lifecycle of a proposal — a
 * person delegates, the author publishes and marks ready, comments gather and go out as
 * one batch, the author resolves, an implementer's session opens, feedback, approval,
 * merge — every drive of an employee being one channel message in the delegating
 * person's name, every refusal the right one, pending comments invisible to employees,
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
  PROPOSALS_CHANNEL,
  ProposalError,
  ProposalService,
  ROUTES_ID,
  slugOf,
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
  channels: Array<{ channelId: string; by: OrgActor; principals: string[] }> = [];
  messages: Array<{ by: OrgActor; channelId: string; text: string }> = [];
  sessions: Array<{ agentId: string; title: string; body: string; workspace?: string }> = [];
  events: ServerEvent[] = [];
  failChannel = false;

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
  async ensureChannel(
    _p: string,
    _o: string,
    channelId: string,
    _opts: { name: string; purpose: string },
    by: OrgActor,
    principals: readonly string[],
  ): Promise<void> {
    if (this.failChannel) throw new Error("channel unavailable");
    this.channels.push({ channelId, by, principals: [...principals] });
  }
  async sendChannelMessage(_p: string, _o: string, by: OrgActor, channelId: string, text: string) {
    if (this.failChannel) throw new Error("channel unavailable");
    this.messages.push({ by, channelId, text });
    return { id: `msg-${this.messages.length}` };
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
  updates: string[] = [];
  failInstall = false;
  async pluginVersion(_p: string, agentId: string, _name: string) {
    return { installed: this.installed.has(agentId) ? this.library : null, library: this.library };
  }
  async updatePlugin(_p: string, agentId: string, _name: string): Promise<void> {
    if (this.failInstall) throw new Error("library unreadable");
    this.updates.push(agentId);
    this.installed.add(agentId);
  }
}

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
    agents = new FakeAgents();
    settings = new FakeSettings();
    lines.length = 0;
    service = new ProposalService({ gateway, agents, root, settings, log });
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
    service = new ProposalService({ gateway, agents, root, settings, log });
    expect(await refused(() => service.list(PROJECT, ORG, OUTSIDER))).toEqual({
      status: 403,
      code: "project_access",
    });
  });

  it("a person delegates: the proposal is numbered, the channel is prepared and the author is @-mentioned in the person's name", async () => {
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
    expect(gateway.channels).toEqual([
      { channelId: PROPOSALS_CHANNEL, by: BOSS, principals: ["agent:acme_dev"] },
    ]);
    expect(gateway.messages).toHaveLength(1);
    expect(gateway.messages[0]).toMatchObject({ by: BOSS, channelId: PROPOSALS_CHANNEL });
    expect(gateway.messages[0]!.text).toContain("@agent:acme_dev proposal:1");
    expect(gateway.messages[0]!.text).toContain("penguin org proposal publish 1");
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

  it("an employee proposes on its own: it is the author and the delegator, nobody is @-mentioned, the channel is prepared", async () => {
    const created = await service.create(PROJECT, ORG, { brief: "Rotate the API token" }, author);
    expect(created).toMatchObject({
      number: 1,
      author: "acme_dev",
      delegatedBy: "agent:acme_dev",
      status: "drafting",
    });
    expect(created.events[0]).toMatchObject({ kind: "created", by: "agent:acme_dev" });
    // Its own desk would only be woken by an @ of itself; the channel still gets it as a
    // member so a batch or an approval can reach it later.
    expect(gateway.messages).toEqual([]);
    expect(gateway.channels).toEqual([
      { channelId: PROPOSALS_CHANNEL, by: author, principals: ["agent:acme_dev"] },
    ]);
    expect(agents.updates).toEqual(["acme_dev"]);
    // Delegating to a colleague: the colleague is the author and is told, in the employee's name.
    const handed = await service.create(
      PROJECT,
      ORG,
      { author: "acme_impl", brief: "Split the sweep" },
      author,
    );
    expect(handed).toMatchObject({ number: 2, author: "acme_impl", delegatedBy: "agent:acme_dev" });
    expect(gateway.messages).toHaveLength(1);
    expect(gateway.messages[0]).toMatchObject({ by: author, channelId: PROPOSALS_CHANNEL });
    expect(gateway.messages[0]!.text).toContain("@agent:acme_impl proposal:2");
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
      { file: "packages/server/src/runtime/organization/reconcile.ts", name: "notifyTicket" },
    ]);
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

  it("comments are the person's own until requested; one request is one batch and one channel message", async () => {
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
    expect(gateway.messages).toHaveLength(1);

    const requested = await service.requestChanges(PROJECT, ORG, n, BOSS);
    expect(requested.status).toBe("drafting");
    expect(requested.pendingComments).toBe(0);
    expect(requested.comments.map((c) => c.batchId)).toEqual(["b1", "b1"]);
    expect(requested.events.at(-1)).toMatchObject({
      kind: "changes_requested",
      by: "user:boss",
      text: "2",
    });
    expect(gateway.messages).toHaveLength(2);
    expect(gateway.messages[1]!.text).toContain(
      "@agent:acme_dev proposal:1 has a batch of 2 comments",
    );
    expect(gateway.messages[1]!.text).toContain(`penguin org proposal comments ${n} --pending`);

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

  it("implement opens the implementer's session on the proposal's text and invites it to the channel", async () => {
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
    expect(gateway.channels.at(-1)).toEqual({
      channelId: PROPOSALS_CHANNEL,
      by: author,
      principals: ["agent:acme_dev", "agent:acme_impl"],
    });
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
    expect(gateway.channels.at(-1)).toEqual({
      channelId: PROPOSALS_CHANNEL,
      by: author,
      principals: ["agent:acme_dev", "agent:acme_dev"],
    });
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
    expect(
      await refused(() => service.addMaterial(PROJECT, ORG, n, { kind: "pr", url: "  " }, impl)),
    ).toEqual({
      status: 400,
      code: "bad_request",
    });
    const before = gateway.messages.length;
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
    expect(gateway.messages[before]!.text).toMatch(
      /^@agent:acme_dev proposal:1 feedback from agent:acme_impl:/,
    );
    expect(gateway.messages[before]!.text).not.toContain("@agent:acme_impl");
    const runtime = await service.feedback(
      PROJECT,
      ORG,
      n,
      { text: "crashes on an empty board", runtime: true },
      qa,
    );
    expect(runtime.events.at(-1)).toMatchObject({ kind: "runtime_feedback", by: "agent:acme_qa" });
    expect(gateway.messages.at(-1)!.text).toMatch(
      /^@agent:acme_dev @agent:acme_impl proposal:1 runtime feedback from agent:acme_qa:/,
    );
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
    expect(gateway.messages.at(-1)!.text).toContain(
      "@agent:acme_dev proposal:1 is approved with nobody building it yet",
    );

    // A second proposal, with an implementer: approval goes to the implementer, who reports the merge.
    const m = (await service.create(PROJECT, ORG, { author: "acme_dev", brief: "Second" }, BOSS))
      .number;
    await service.publish(PROJECT, ORG, m, DOC, author);
    await service.implement(PROJECT, ORG, m, { agentId: "acme_impl" }, author);
    await service.approve(PROJECT, ORG, m, BOSS);
    expect(gateway.messages.at(-1)!.text).toContain(
      `@agent:acme_impl proposal:${m} is approved — merge it`,
    );
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
    expect(gateway.messages.at(-1)!.text).toContain(
      "@agent:acme_dev proposal:1 is rejected: Not this quarter.",
    );
    expect(await refused(() => service.publish(PROJECT, ORG, n, DOC, author))).toEqual({
      status: 409,
      code: "proposal_closed",
    });
  });

  it("unread counts what happened since the person's read position, never their own doing; employees count nothing", async () => {
    const n = await delegated();
    await service.publish(PROJECT, ORG, n, DOC, author);
    await service.ready(PROJECT, ORG, n, author);
    let list = await service.list(PROJECT, ORG, BOSS);
    expect(list.proposals[0]).toMatchObject({ number: n, unread: 2 });
    expect(list.channelId).toBe(PROPOSALS_CHANNEL);
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

  it("a channel that fails never fails the write: the ledger has the line, the log has the reason", async () => {
    gateway.failChannel = true;
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_dev", brief: "Still recorded" },
      BOSS,
    );
    expect(created.number).toBe(1);
    expect(gateway.messages).toEqual([]);
    expect(
      lines.some(
        // The channel step fails at its first stop, preparing the channel; a later failure would say "message not sent".
        (l) => l.includes("channel not prepared") && l.includes("channel unavailable"),
      ),
    ).toBe(true);
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
});
