/**
 * The archive page's routes (`/api/me/archived-sessions*`) and the archive marks behind them.
 *
 * Every scenario builds its own world with only the users it needs. The owner's own Project is P1.
 * A scenario that spans Projects adds the peer: a member of P1, whose own Project P2 has the owner
 * as a member. P3 is the admin's `default_project`, which the owner is never let into, and the
 * admin, a member of neither P1 nor P2, is the stranger.
 *
 * - Given Sessions of every kind, the groups count only the archived rows of the Projects the
 *   user can open — a hand-archived conversation, unkept api / schedule / cli Sessions, an api
 *   Session that never ran — by Workspace under Project, newest first; never a person's active
 *   conversation, a subagent, or a Session of a Project the user cannot open.
 * - Given a group, its rows page newest first by cursor, each row exactly once.
 * - Given many archived Sessions, the counts build no Session's full view and a page builds one
 *   per row it returns.
 * - Given archived runs beside a conversation, the Session list stamps each Workspace's newest
 *   Session (the picker's) and, apart, its newest active one (the sidebar's order).
 * - Given a query, it matches a stored title and a first-prompt title; the source filter keeps
 *   one kind (`user` = archived by hand); a Project filter keeps one Project.
 * - Given ids, unarchive keeps each archived one in the sidebar's list, through a later run;
 *   a named Session that is not archived is not counted, and an id the user cannot open is
 *   reported missing.
 * - Given a kept Session, archiving it again files it away; unarchiving through PATCH keeps it.
 * - Given a filter naming one Workspace, unarchive acts on that Workspace only.
 * - Given ids, delete removes each Session's Trace files and row, and its subagent children with
 *   it; an id the user cannot open is reported missing.
 * - Given a group's batch pinned to the time its count was read, it acts on the Sessions that
 *   count saw: one archived or created after it is left alone, and so is a running one, which a
 *   group's delete never aborts (deleting it by id still does); a row it excludes — unticked
 *   after Select all — stays where it is.
 * - Given a running archived Session, delete aborts its run before the files go.
 * - Given a subagent or company Session, archiving or unarchiving it is a 409 that changes
 *   nothing.
 * - Given a change, the Project's owner and members hear `session_archived` /
 *   `session_deleted` for each Session, and nobody else does.
 * - Given a malformed request, the answer is a 400 (an unknown Project a 404), and nothing moves.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestBegin, sessionMeta, subagentEvent, userText } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type {
  ArchivedSessionGroupsResponse,
  ArchivedSessionsBatchResponse,
  ArchivedSessionsResponse,
  ServerEvent,
  SessionResponse,
  SessionSource,
  SessionsResponse,
} from "../src/api/types.js";
import { ADMIN_USER_ID } from "../src/auth/service.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { apiClient, createTestApp, provisionUser, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeSession } from "./fixtures/session.js";

const AGENT = "default_agent";
const DAY = "2026-10-11";

describe("the archive page", () => {
  let t: TestApp;
  let seq = 0;

  // Every Project is written with the built-in Agent's skills (createTestApp leaves the built-in
  // Benchmarks out), and on the Windows runner writing and removing them is a real share of a
  // scenario's time. So each scenario boots its own app and removes its own data root (one root
  // shared by all of them once outgrew the 30 s hook budget), and provisions only the users it
  // needs; each user brings a default Project.
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** The owner and its own Project P1; P3 is the admin's, which the owner cannot open. */
  async function world() {
    const names = { owner: "ar_owner", peer: "ar_peer", stranger: ADMIN_USER_ID };
    const owner = apiClient(t.app, (await provisionUser(t.app, names.owner)).cookie);
    return { names, owner, p1: `${names.owner}-default_project`, p3: "default_project" };
  }

  /** `world()` and the peer: a member of P1, whose own Project P2 has the owner as a member. */
  async function worldWithPeer() {
    const w = await world();
    const peer = apiClient(t.app, (await provisionUser(t.app, w.names.peer)).cookie);
    const p2 = `${w.names.peer}-default_project`;
    expect(
      (await w.owner.post(`/api/projects/${w.p1}/members`, { userId: w.names.peer })).status,
    ).toBe(201);
    expect((await peer.post(`/api/projects/${p2}/members`, { userId: w.names.owner })).status).toBe(
      201,
    );
    return { ...w, p2 };
  }

  const traceFile = (projectId: string, sessionId: string) =>
    path.join(t.root, projectId, "agents", AGENT, "traces", DAY, `${sessionId}_001.jsonl`);

  /**
   * A Session as an earlier process left it: its index row (with `title` stored when given) and,
   * unless `trace: false`, a Trace whose head records `source` and whose first prompt is
   * `prompt`, then the `extra` records, written when the Session was (a `subagent` pointer it
   * records is its own child). Each seed is newer than the one before it.
   */
  async function seed(
    projectId: string,
    opts: {
      source?: SessionSource;
      client?: "web" | "cli" | "org" | "api";
      workspace?: string;
      title?: string;
      prompt?: string;
      trace?: boolean;
      extra?: AmspRecord[];
      /** When it was created and last active (ISO); by default each seed is a second newer. */
      at?: string;
    } = {},
  ): Promise<string> {
    seq += 1;
    const n = String(seq).padStart(4, "0");
    const sessionId = `session-${DAY}-09-00-00-a7c1${n}`;
    const stamp = opts.at ?? new Date(Date.UTC(2026, 9, 11, 9, 0, 0) + seq * 1000).toISOString();
    const workspace = opts.workspace ?? "/tmp/arch-ws-a";
    const traced = opts.trace !== false;
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId,
      agentId: AGENT,
      provider: "custom",
      modelId: "m-x",
      workspace,
      approvalMode: "allow-all",
      title: opts.title ?? null,
      client: opts.client ?? "web",
      hasTrace: traced,
      createdAt: stamp,
      lastActiveAt: stamp,
    });
    if (traced) {
      const meta = {
        session_id: sessionId,
        model_id: "m-x",
        provider: "custom",
        model_context_window: 1000,
        system_prompt: "",
        agent_state: "/tmp/a",
        workspace,
        source: opts.source ?? "user",
      };
      await writeTraceFile(t.root, projectId, AGENT, DAY, sessionId, 1, [
        sessionMeta(meta as Parameters<typeof sessionMeta>[0]),
        userText(opts.prompt ?? `work ${n}`),
        ...(opts.extra ?? []).map((message) => ({ ...message, timestamp: stamp })),
      ]);
    }
    return sessionId;
  }

  /** The merged temporary Workspaces' kind of path: core's auto-created directory. */
  const tempWorkspace = (projectId: string) =>
    path.join(t.root, projectId, "agents", AGENT, "workspaces", "tmp-0000abcd");

  /** One Session of every kind, in this order (so `latest` rises down the list). */
  async function seedEveryKind(w: Awaited<ReturnType<typeof worldWithPeer>>) {
    const active = await seed(w.p1);
    const byHand = await seed(w.p1, { title: "Quarterly report" });
    expect((await w.owner.patch(`/api/sessions/${byHand}`, { archived: true })).status).toBe(200);
    const cliA = await seed(w.p1, { source: "cli", prompt: "deploy the docs site" });
    const cliB = await seed(w.p1, { source: "cli", workspace: "/tmp/arch-ws-b" });
    const scheduled = await seed(w.p1, { source: "schedule", workspace: tempWorkspace(w.p1) });
    const apiUnrun = await seed(w.p1, { client: "api", trace: false, workspace: "/tmp/arch-ws-b" });
    const subagent = await seed(w.p1, { source: "subagent" });
    const peerCli = await seed(w.p2, { source: "cli", workspace: "/tmp/arch-ws-c" });
    const hidden = await seed(w.p3, { source: "cli" });
    return { active, byHand, cliA, cliB, scheduled, apiUnrun, subagent, peerCli, hidden };
  }

  type Client = ReturnType<typeof apiClient>;
  const json = async <T>(pending: Response | Promise<Response>, status = 200): Promise<T> => {
    const res = await pending;
    expect(res.status).toBe(status);
    return (await res.json()) as T;
  };
  const groups = (client: Client, qs = "") =>
    json<ArchivedSessionGroupsResponse>(client.get(`/api/me/archived-sessions/groups${qs}`));
  const rows = (client: Client, qs: string) =>
    json<ArchivedSessionsResponse>(client.get(`/api/me/archived-sessions?${qs}`));
  const batch = (client: Client, action: string, body: unknown) =>
    json<ArchivedSessionsBatchResponse>(client.post(`/api/me/archived-sessions/${action}`, body));
  const activeIds = async (client: Client, projectId: string) =>
    (
      await json<SessionsResponse>(
        client.get(`/api/projects/${projectId}/agents/${AGENT}/sessions?category=active`),
      )
    ).sessions.map((s) => s.sessionId);
  const archivedFlag = async (client: Client, sessionId: string) =>
    (await json<SessionResponse>(client.get(`/api/sessions/${sessionId}`))).session.archived;
  const enc = encodeURIComponent;

  /** The server events a user's channel carries from now on (the channel a client holds open). */
  function inbox(userId: string): ServerEvent[] {
    const events: ServerEvent[] = [];
    t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
      if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
    });
    return events;
  }
  const listingEvents = (events: ServerEvent[]) =>
    events.filter((e) => e.type === "session_archived" || e.type === "session_deleted");

  it("counts only the archived rows of the Projects the user can open, by Workspace under Project, newest first", async () => {
    const w = await worldWithPeer();
    await seedEveryKind(w);
    const body = await groups(w.owner);
    expect(body.groups.map((g) => [g.projectId, g.projectName, g.workspace, g.count])).toEqual([
      [w.p2, w.names.peer, "/tmp/arch-ws-c", 1],
      [w.p1, w.names.owner, "/tmp/arch-ws-b", 2],
      [w.p1, w.names.owner, "temp", 1],
      [w.p1, w.names.owner, "/tmp/arch-ws-a", 2],
    ]);
    expect(body.total).toBe(6);
  });

  it("pages a group's rows newest first by cursor, each row exactly once", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    const group = `projectId=${w.p1}&workspace=${enc("/tmp/arch-ws-a")}`;
    const first = await rows(w.owner, `${group}&limit=1`);
    expect(first.sessions.map((s) => s.sessionId)).toEqual([ids.cliA]);
    expect(first.hasMore).toBe(true);
    // An untitled row carries its first prompt as its title.
    expect(first.sessions[0]!.title).toBe("deploy the docs site");
    const last = first.sessions[0]!;
    const second = await rows(
      w.owner,
      `${group}&limit=1&before=${enc(`${last.lastActiveAt},${last.sessionId}`)}`,
    );
    expect(second.sessions.map((s) => s.sessionId)).toEqual([ids.byHand]);
    expect(second.hasMore).toBe(false);
    expect(
      (await rows(w.owner, `projectId=${w.p1}&workspace=temp&limit=10`)).sessions.map(
        (s) => s.sessionId,
      ),
    ).toEqual([ids.scheduled]);
  });

  it("builds a Session's full view only for the rows a page returns, however many are archived", async () => {
    const w = await world();
    for (let i = 0; i < 25; i += 1) {
      await seed(w.p1, { source: "cli", workspace: "/tmp/arch-ws-many" });
    }
    const toInfo = vi.spyOn(t.deps.sessionService, "toInfo");
    try {
      const counted = await groups(w.owner, `?projectId=${w.p1}`);
      expect(counted.groups.find((g) => g.workspace === "/tmp/arch-ws-many")?.count).toBe(25);
      expect(toInfo).not.toHaveBeenCalled();
      const page = await rows(
        w.owner,
        `projectId=${w.p1}&workspace=${enc("/tmp/arch-ws-many")}&limit=10`,
      );
      expect(page.sessions).toHaveLength(10);
      expect(page.hasMore).toBe(true);
      expect(toInfo).toHaveBeenCalledTimes(10);
    } finally {
      toInfo.mockRestore();
    }
  });

  it("stamps a Workspace's newest Session for the picker and its newest active one for the sidebar", async () => {
    const w = await world();
    const conversation = await seed(w.p1, { workspace: "/tmp/arch-ws-stamp" });
    const run = await seed(w.p1, { source: "cli", workspace: "/tmp/arch-ws-stamp" });
    const onlyRuns = await seed(w.p1, { source: "schedule", workspace: "/tmp/arch-ws-runs" });
    const list = await json<SessionsResponse>(
      w.owner.get(
        `/api/projects/${w.p1}/agents/${AGENT}/sessions?category=active&counts=1&order=activity&limit=11`,
      ),
    );
    const created = (id: string) => t.deps.sessionsRepo.findById(id)!.createdAt;
    expect(list.workspaceLatest?.["/tmp/arch-ws-stamp"]).toBe(created(run));
    expect(list.workspaceLatestActive?.["/tmp/arch-ws-stamp"]).toBe(created(conversation));
    // A Workspace holding nothing but archived Sessions is recently used, but no sidebar group.
    expect(list.workspaceLatest?.["/tmp/arch-ws-runs"]).toBe(created(onlyRuns));
    expect(list.workspaceLatestActive).not.toHaveProperty("/tmp/arch-ws-runs");
  });

  it("matches a stored title and a first-prompt title, and filters by source and by Project", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    const counted = async (qs: string) =>
      (await groups(w.owner, qs)).groups.map((g) => [g.projectId, g.workspace, g.count]);
    expect(await counted("?q=QUARTERLY")).toEqual([[w.p1, "/tmp/arch-ws-a", 1]]);
    expect(
      (
        await rows(
          w.owner,
          `projectId=${w.p1}&workspace=${enc("/tmp/arch-ws-a")}&limit=10&q=deploy`,
        )
      ).sessions.map((s) => s.sessionId),
    ).toEqual([ids.cliA]);
    // Archived by hand is its own kind: the program-opened rows beside it are not.
    expect(await counted("?source=user")).toEqual([[w.p1, "/tmp/arch-ws-a", 1]]);
    expect(await counted("?source=schedule")).toEqual([[w.p1, "temp", 1]]);
    expect(await counted("?source=api")).toEqual([[w.p1, "/tmp/arch-ws-b", 1]]);
    expect(await counted(`?projectId=${w.p2}`)).toEqual([[w.p2, "/tmp/arch-ws-c", 1]]);
  });

  it("unarchives by id into the sidebar's list, for good; counts only archived rows and reports what the user cannot open", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    const done = await batch(w.owner, "unarchive", {
      sessionIds: [ids.cliA, ids.active, ids.hidden, "session-nobody"],
    });
    expect(done).toEqual({ done: 1, missing: [ids.hidden, "session-nobody"] });
    expect(await activeIds(w.owner, w.p1)).toEqual([ids.cliA, ids.active]);
    expect(await archivedFlag(w.owner, ids.cliA)).toBe(false);
    // A later run leaves the keep mark alone: the Session stays in the sidebar's list.
    const row = t.deps.sessionsRepo.findById(ids.cliA)!;
    t.deps.manager.adopt(
      row,
      fakeSession(ids.cliA, {
        async *run() {
          yield requestBegin();
        },
      }),
    );
    await t.deps.manager.startTask(ids.cliA, [userText("again")]);
    await waitFor(() => t.deps.manager.statusOf(ids.cliA) === "idle");
    expect(await activeIds(w.owner, w.p1)).toContain(ids.cliA);
    // The peer's Session the owner may open is unarchived the same way.
    expect(await batch(w.owner, "unarchive", { sessionIds: [ids.peerCli] })).toEqual({
      done: 1,
      missing: [],
    });
  });

  it("files a kept Session away again when it is archived, and keeps it when PATCH unarchives it", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    expect((await w.owner.patch(`/api/sessions/${ids.cliB}`, { archived: false })).status).toBe(
      200,
    );
    expect(await archivedFlag(w.owner, ids.cliB)).toBe(false);
    expect(await activeIds(w.owner, w.p1)).toContain(ids.cliB);
    expect((await w.owner.patch(`/api/sessions/${ids.cliB}`, { archived: true })).status).toBe(200);
    expect(await archivedFlag(w.owner, ids.cliB)).toBe(true);
    expect(await activeIds(w.owner, w.p1)).not.toContain(ids.cliB);
    expect(
      (await groups(w.owner, `?projectId=${w.p1}`)).groups.find(
        (g) => g.workspace === "/tmp/arch-ws-b",
      )?.count,
    ).toBe(2);
  });

  it("unarchives every archived row of one Workspace through a filter, and nothing else", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    const done = await batch(w.owner, "unarchive", {
      filter: { projectId: w.p1, workspace: "/tmp/arch-ws-b" },
    });
    expect(done).toEqual({ done: 2, missing: [] });
    expect(new Set(await activeIds(w.owner, w.p1))).toEqual(
      new Set([ids.active, ids.cliB, ids.apiUnrun]),
    );
    expect((await groups(w.owner, `?projectId=${w.p1}`)).total).toBe(3);
  });

  it("deletes by id: the files, the row and the subagent children go; what the user cannot open is missing", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    const child = await seed(w.p1, { source: "subagent" });
    const parent = await seed(w.p1, { extra: [subagentEvent(child)] });
    expect((await w.owner.patch(`/api/sessions/${parent}`, { archived: true })).status).toBe(200);
    const done = await batch(w.owner, "delete", { sessionIds: [parent, ids.hidden] });
    expect(done).toEqual({ done: 1, missing: [ids.hidden] });
    for (const id of [parent, child]) {
      expect(t.deps.sessionsRepo.findById(id), id).toBeNull();
      await expect(fs.stat(traceFile(w.p1, id)), id).rejects.toThrow();
    }
    // The Session the owner could not open is untouched.
    expect(t.deps.sessionsRepo.findById(ids.hidden)).not.toBeNull();
  });

  it("acts on a group as its count saw it: what came after is untouched, and a running Session is not aborted", async () => {
    const w = await world();
    const ws = "/tmp/arch-ws-snapshot";
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
    const counted = await seed(w.p1, { source: "cli", workspace: ws, at: ago(120) });
    const byHand = await seed(w.p1, { workspace: ws, at: ago(110) });
    expect((await w.owner.patch(`/api/sessions/${byHand}`, { archived: true })).status).toBe(200);
    const running = await seed(w.p1, { source: "cli", workspace: ws, at: ago(100) });
    t.deps.manager.adopt(
      t.deps.sessionsRepo.findById(running)!,
      fakeSession(running, {
        async *run(_input, { signal }) {
          yield requestBegin();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        },
      }),
    );
    await t.deps.manager.startTask(running, [userText("long job")]);
    await waitFor(() => t.deps.manager.statusOf(running) === "running");
    const laterByHand = await seed(w.p1, { workspace: ws, at: ago(90) });

    const snapshot = await groups(w.owner, `?projectId=${w.p1}`);
    expect(snapshot.groups.find((g) => g.workspace === ws)?.count).toBe(3);
    // After the count: a program opens another Session, and the user archives a conversation.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const arrived = await seed(w.p1, {
      source: "api",
      client: "api",
      trace: false,
      workspace: ws,
      at: new Date().toISOString(),
    });
    expect((await w.owner.patch(`/api/sessions/${laterByHand}`, { archived: true })).status).toBe(
      200,
    );

    const filter = { projectId: w.p1, workspace: ws, until: snapshot.asOf };
    expect(await batch(w.owner, "delete", { filter })).toEqual({ done: 2, missing: [] });
    for (const gone of [counted, byHand]) expect(t.deps.sessionsRepo.findById(gone)).toBeNull();
    expect(t.deps.manager.statusOf(running)).toBe("running");
    for (const kept of [running, arrived, laterByHand]) {
      expect(await archivedFlag(w.owner, kept), kept).toBe(true);
    }
    // Unarchiving the group as that count saw it reaches the running Session, and only it.
    expect(await batch(w.owner, "unarchive", { filter })).toEqual({ done: 1, missing: [] });
    expect(await archivedFlag(w.owner, running)).toBe(false);
    expect(await archivedFlag(w.owner, arrived)).toBe(true);
    expect(await archivedFlag(w.owner, laterByHand)).toBe(true);
    // Named by id, a running Session is still aborted and deleted.
    expect(await batch(w.owner, "delete", { sessionIds: [running] })).toEqual({
      done: 1,
      missing: [],
    });
    expect(t.deps.sessionsRepo.findById(running)).toBeNull();
  });

  it("leaves out the rows a group's batch excludes: the ones unticked after Select all", async () => {
    const w = await world();
    const ws = "/tmp/arch-ws-exclude";
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
    const unticked = await seed(w.p1, { source: "cli", workspace: ws, at: ago(60) });
    const chosen = await seed(w.p1, { source: "cli", workspace: ws, at: ago(50) });
    const snapshot = await groups(w.owner, `?projectId=${w.p1}`);
    const filter = { projectId: w.p1, workspace: ws, until: snapshot.asOf, exclude: [unticked] };
    expect(await batch(w.owner, "unarchive", { filter })).toEqual({ done: 1, missing: [] });
    expect(await archivedFlag(w.owner, chosen)).toBe(false);
    expect(await archivedFlag(w.owner, unticked)).toBe(true);
  });

  it("aborts a running Session's run before deleting it", async () => {
    const w = await world();
    const running = await seed(w.p1, { source: "cli" });
    let aborted = false;
    t.deps.manager.adopt(
      t.deps.sessionsRepo.findById(running)!,
      fakeSession(running, {
        async *run(_input, { signal }) {
          yield requestBegin();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
          aborted = true;
        },
      }),
    );
    await t.deps.manager.startTask(running, [userText("long job")]);
    await waitFor(() => t.deps.manager.statusOf(running) === "running");
    expect(await batch(w.owner, "delete", { sessionIds: [running] })).toEqual({
      done: 1,
      missing: [],
    });
    expect(aborted).toBe(true);
    expect(t.deps.sessionsRepo.findById(running)).toBeNull();
  });

  it("refuses to archive or unarchive a subagent or company Session, changing nothing", async () => {
    const w = await world();
    const subagent = await seed(w.p1, { source: "subagent" });
    const desk = await seed(w.p1, { source: "company", client: "org" });
    for (const id of [subagent, desk]) {
      for (const archived of [true, false]) {
        const res = await w.owner.patch(`/api/sessions/${id}`, { archived });
        expect(res.status, id).toBe(409);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          "session_not_listed",
        );
      }
      expect(t.deps.sessionsRepo.findById(id)).toMatchObject({ archivedAt: null, keptAt: null });
    }
  });

  it("tells the Project's owner and members about each change, and nobody else", async () => {
    const w = await worldWithPeer();
    const boxes = {
      owner: inbox(w.names.owner),
      peer: inbox(w.names.peer),
      stranger: inbox(w.names.stranger),
    };
    const cli = await seed(w.p1, { source: "cli" });
    const child = await seed(w.p1, { source: "subagent" });
    const parent = await seed(w.p1, { extra: [subagentEvent(child)] });
    await w.owner.patch(`/api/sessions/${parent}`, { archived: true });
    await batch(w.owner, "unarchive", { sessionIds: [cli] });
    await batch(w.owner, "delete", { sessionIds: [parent] });
    for (const who of ["owner", "peer"] as const) {
      expect(listingEvents(boxes[who]), who).toEqual([
        {
          type: "session_archived",
          sessionId: parent,
          projectId: w.p1,
          agentId: AGENT,
          archived: true,
        },
        {
          type: "session_archived",
          sessionId: cli,
          projectId: w.p1,
          agentId: AGENT,
          archived: false,
        },
        { type: "session_deleted", sessionId: child, projectId: w.p1 },
        { type: "session_deleted", sessionId: parent, projectId: w.p1 },
      ]);
    }
    expect(listingEvents(boxes.stranger)).toEqual([]);
  });

  it("refuses a malformed request with a 400, and an unknown Project with a 404, moving nothing", async () => {
    const w = await worldWithPeer();
    const ids = await seedEveryKind(w);
    const status = async (res: Response | Promise<Response>) => (await res).status;
    const group = `projectId=${w.p1}&workspace=${enc("/tmp/arch-ws-a")}`;
    expect(await status(w.owner.get(`/api/me/archived-sessions/groups?q=${"x".repeat(201)}`))).toBe(
      400,
    );
    expect(await status(w.owner.get("/api/me/archived-sessions/groups?source=subagent"))).toBe(400);
    expect(await status(w.owner.get(`/api/me/archived-sessions/groups?projectId=${w.p3}`))).toBe(
      404,
    );
    expect(await status(w.owner.get("/api/me/archived-sessions/groups?projectId=nope"))).toBe(404);
    expect(await status(w.owner.get(`/api/me/archived-sessions?${group}`))).toBe(400);
    expect(await status(w.owner.get(`/api/me/archived-sessions?${group}&limit=101`))).toBe(400);
    expect(await status(w.owner.get(`/api/me/archived-sessions?${group}&limit=5&before=x`))).toBe(
      400,
    );
    expect(await status(w.owner.get(`/api/me/archived-sessions?projectId=${w.p1}&limit=5`))).toBe(
      400,
    );
    const post = (body: unknown) =>
      status(w.owner.post("/api/me/archived-sessions/unarchive", body));
    expect(await post({ sessionIds: [ids.cliA], filter: {} })).toBe(400);
    expect(await post({})).toBe(400);
    expect(await post({ sessionIds: [] })).toBe(400);
    expect(await post({ sessionIds: Array.from({ length: 501 }, (_, i) => `session-${i}`) })).toBe(
      400,
    );
    expect(await post({ sessionIds: ["../etc"] })).toBe(400);
    expect(await post({ filter: { source: "subagent" } })).toBe(400);
    expect(await post({ filter: { until: "yesterday" } })).toBe(400);
    expect(await post({ filter: { exclude: [] } })).toBe(400);
    expect(await post({ filter: { exclude: ["../etc"] } })).toBe(400);
    expect(await archivedFlag(w.owner, ids.cliA)).toBe(true);
  });
});
