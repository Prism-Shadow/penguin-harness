/**
 * POST /api/projects/:projectId/sessions/archive: the sidebar's "delete workspace" archives every
 * active conversation of one Workspace group, loaded on a page or not, in one request.
 *
 * One app serves the file: the owner's Project with two Agents, a member of that Project, and a
 * user outside it. Each scenario seeds its own Workspace paths, so none sees another's rows.
 *
 * - Given active conversations of two Agents in Workspace A and one in Workspace B, archiving A
 *   answers `done: 2`; the list then serves none of A's as active and both as archived, and B's
 *   is untouched.
 * - Given an already archived conversation, an unkept `api` Session, a subagent Session and an
 *   organization's Session in A, none is counted or changed.
 * - Given a program's Session the user kept in A, it is archived again.
 * - Given a running conversation in A, it is archived and still running afterwards.
 * - Given an archive, each archived Session is announced once as `session_archived` to the
 *   Project's owner and members and to nobody else; a Workspace with nothing active answers
 *   `done: 0` and announces nothing.
 * - Given a member, the archive is done; given a user outside the Project, it is a 404
 *   `project_not_found` and nothing changes.
 * - Given a missing, non-string or blank `workspaceGroup`, it is a 400 and nothing changes.
 * - Given an archived Workspace, unarchiving one of its conversations puts the Workspace back in
 *   the list's per-Workspace counts with one active conversation.
 * - Given `temp`, the conversations of temporary Workspaces are archived and no named one.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestBegin, sessionMeta, userText } from "@prismshadow/penguin-core";
import type {
  ServerEvent,
  SessionSource,
  SessionsArchiveResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { apiClient, createTestApp, provisionUser, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeSession, uniqueSessionId } from "./fixtures/session.js";

const AGENT = "default_agent";
const SECOND = "wsarch_second";
const DAY = "2026-09-01";
const STAMP = "2026-09-01T10:00:00.000Z";

describe("POST /api/projects/:projectId/sessions/archive", () => {
  let t: TestApp;
  type Client = ReturnType<typeof apiClient>;
  let owner: Client;
  let member: Client;
  let stranger: Client;
  const names = { owner: "wsarch_owner", member: "wsarch_member", stranger: "wsarch_stranger" };
  const projectId = `${names.owner}-default_project`;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, names.owner)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, names.member)).cookie);
    stranger = apiClient(t.app, (await provisionUser(t.app, names.stranger)).cookie);
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: names.member })).status,
    ).toBe(201);
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: SECOND })).status,
    ).toBe(201);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /**
   * A Session as its index row (client `web` unless given) and, when `source` is given, a Trace
   * whose head records it — the only place a run records where it came from.
   */
  async function seed(
    workspace: string,
    opts: { agentId?: string; client?: "web" | "api" | "org"; source?: SessionSource } = {},
  ): Promise<string> {
    const sessionId = uniqueSessionId();
    const agentId = opts.agentId ?? AGENT;
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId,
      agentId,
      provider: "custom",
      modelId: "m-x",
      workspace,
      approvalMode: "allow-all",
      title: null,
      client: opts.client ?? "web",
      hasTrace: opts.source !== undefined,
      createdAt: STAMP,
      lastActiveAt: STAMP,
    });
    if (opts.source !== undefined) {
      const meta = {
        session_id: sessionId,
        model_id: "m-x",
        provider: "custom",
        model_context_window: 1000,
        system_prompt: "",
        agent_state: "/tmp/a",
        workspace,
        source: opts.source,
      };
      await writeTraceFile(t.root, projectId, agentId, DAY, sessionId, 1, [
        sessionMeta(meta as Parameters<typeof sessionMeta>[0]),
        userText("work"),
      ]);
    }
    return sessionId;
  }

  const archive = (client: Client, body: unknown) =>
    client.post(`/api/projects/${projectId}/sessions/archive`, body);
  const archived = async (client: Client, workspaceGroup: string): Promise<number> => {
    const res = await archive(client, { workspaceGroup });
    expect(res.status).toBe(200);
    return ((await res.json()) as SessionsArchiveResponse).done;
  };
  /** The ids the list serves for one Agent, one category and one Workspace group. */
  const listed = async (agentId: string, category: string, workspaceGroup: string) => {
    const qs = `category=${category}&excludeOrg=1&workspaceGroup=${encodeURIComponent(workspaceGroup)}`;
    const res = await owner.get(`/api/projects/${projectId}/agents/${agentId}/sessions?${qs}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as SessionsResponse).sessions.map((s) => s.sessionId).sort();
  };
  /** The marks a row carries, read straight from the index. */
  const marks = (sessionId: string) => {
    const row = t.deps.sessionsRepo.findById(sessionId)!;
    return { archivedAt: row.archivedAt, keptAt: row.keptAt };
  };
  type ArchivedEvent = Extract<ServerEvent, { type: "session_archived" }>;
  /** The `session_archived` events a user's channel carries from now on. */
  function inbox(userId: string): ArchivedEvent[] {
    const events: ArchivedEvent[] = [];
    t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
      if (evt.event !== "server_event") return;
      const event = JSON.parse(evt.data) as ServerEvent;
      if (event.type === "session_archived") events.push(event);
    });
    return events;
  }

  it("archives the group's conversations of every Agent and leaves another Workspace alone", async () => {
    const a = "/tmp/wsarch-two-agents-a";
    const b = "/tmp/wsarch-two-agents-b";
    const first = await seed(a);
    const second = await seed(a, { agentId: SECOND });
    const elsewhere = await seed(b);

    expect(await archived(owner, a)).toBe(2);
    expect(await listed(AGENT, "active", a)).toEqual([]);
    expect(await listed(SECOND, "active", a)).toEqual([]);
    expect(await listed(AGENT, "archived", a)).toEqual([first]);
    expect(await listed(SECOND, "archived", a)).toEqual([second]);
    expect(await listed(AGENT, "active", b)).toEqual([elsewhere]);
  });

  it("counts and changes no archived, unkept program, subagent or organization Session", async () => {
    const a = "/tmp/wsarch-left-alone";
    const conversation = await seed(a);
    const byHand = await seed(a);
    t.deps.sessionsRepo.setListing([byHand], "archived", STAMP);
    const unkeptApi = await seed(a, { client: "api" });
    const subagent = await seed(a, { source: "subagent" });
    // A person's conversation an organization owns: `user` by its head, `org` by its stamp.
    const orgOwned = await seed(a, { client: "org", source: "user" });
    const before = [byHand, unkeptApi, subagent, orgOwned].map(marks);

    expect(await archived(owner, a)).toBe(1);
    expect(marks(conversation).archivedAt).not.toBeNull();
    expect([byHand, unkeptApi, subagent, orgOwned].map(marks)).toEqual(before);
  });

  it("archives a program's Session the user had kept in the sidebar", async () => {
    const a = "/tmp/wsarch-kept";
    const kept = await seed(a, { client: "api" });
    t.deps.sessionsRepo.setListing([kept], "kept", STAMP);

    expect(await archived(owner, a)).toBe(1);
    expect(marks(kept)).toEqual({ archivedAt: expect.any(String), keptAt: null });
    expect(await listed(AGENT, "archived", a)).toEqual([kept]);
  });

  it("archives a running conversation without stopping it", async () => {
    const a = "/tmp/wsarch-running";
    const running = await seed(a);
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

    expect(await archived(owner, a)).toBe(1);
    expect(t.deps.manager.statusOf(running)).toBe("running");
    expect(await listed(AGENT, "archived", a)).toEqual([running]);
    t.deps.manager.abortTask(running);
    await waitFor(() => t.deps.manager.statusOf(running) !== "running");
  });

  it("announces each archived Session once to the owner and members and to nobody else", async () => {
    const a = "/tmp/wsarch-announced";
    const boxes = {
      owner: inbox(names.owner),
      member: inbox(names.member),
      stranger: inbox(names.stranger),
    };
    const one = await seed(a);
    const two = await seed(a, { agentId: SECOND });

    expect(await archived(owner, a)).toBe(2);
    const expected = [
      { type: "session_archived", sessionId: one, projectId, agentId: AGENT, archived: true },
      { type: "session_archived", sessionId: two, projectId, agentId: SECOND, archived: true },
    ];
    const bySession = (events: ArchivedEvent[]) =>
      [...events].sort((x, y) => x.sessionId.localeCompare(y.sessionId));
    expect(bySession(boxes.owner)).toEqual(expected);
    expect(bySession(boxes.member)).toEqual(expected);
    expect(boxes.stranger).toEqual([]);

    // Nothing left to archive: nothing is written and nothing announced.
    expect(await archived(owner, a)).toBe(0);
    expect(await archived(owner, "/tmp/wsarch-never-used")).toBe(0);
    expect(boxes.owner).toHaveLength(2);
  });

  it("lets a member archive a group and answers a user outside the Project as an unknown one", async () => {
    const a = "/tmp/wsarch-who";
    const conversation = await seed(a);
    const refused = await archive(stranger, { workspaceGroup: a });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "project_not_found",
    );
    expect(marks(conversation).archivedAt).toBeNull();

    expect(await archived(member, a)).toBe(1);
    expect(marks(conversation).archivedAt).not.toBeNull();
  });

  it("refuses a missing, non-string or blank group with a 400, changing nothing", async () => {
    const a = "/tmp/wsarch-malformed";
    const conversation = await seed(a);
    for (const body of [{}, { workspaceGroup: 7 }, { workspaceGroup: "   " }]) {
      expect((await archive(owner, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(marks(conversation)).toEqual({ archivedAt: null, keptAt: null });
  });

  it("brings the Workspace back to the list's counts when one of its conversations is unarchived", async () => {
    const a = "/tmp/wsarch-comes-back";
    const first = await seed(a);
    await seed(a);
    expect(await archived(owner, a)).toBe(2);
    const counts = async () => {
      const res = await owner.get(
        `/api/projects/${projectId}/agents/${AGENT}/sessions?category=active&excludeOrg=1&counts=1&limit=10`,
      );
      return ((await res.json()) as SessionsResponse).workspaceCounts?.[a];
    };
    expect(await counts()).toEqual({ active: 0, archived: 2 });

    expect((await owner.patch(`/api/sessions/${first}`, { archived: false })).status).toBe(200);
    expect(await counts()).toEqual({ active: 1, archived: 1 });
  });

  it("archives the temporary Workspaces' conversations for `temp`, and no named Workspace's", async () => {
    const agentWorkspaces = path.join(t.root, projectId, "agents", AGENT, "workspaces");
    const auto = await seed(path.join(agentWorkspaces, "tmp-0000abcd"));
    const testWorkspace = await seed(path.join(agentWorkspaces, "eval-case-1"));
    const named = await seed("/tmp/wsarch-named");

    expect(await archived(owner, "temp")).toBe(2);
    expect(marks(auto).archivedAt).not.toBeNull();
    expect(marks(testWorkspace).archivedAt).not.toBeNull();
    expect(marks(named).archivedAt).toBeNull();
  });
});
