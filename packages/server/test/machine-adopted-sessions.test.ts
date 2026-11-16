/**
 * A machine's Sessions as the server that adopted it reads them, and the archive page that lists
 * them beside its own.
 *
 * Two apps: the machine (its own Sessions, its own admin) and the server that adopted it, whose
 * machines node hands out a client to the machine's API — the machine app itself, called with its
 * admin's session and the adoption time, the way machines/service.ts projectApis builds one.
 *
 * - Given Sessions a machine held before it was adopted and one created after, a read carrying
 *   the adoption time files the earlier person's conversation away as a CLI task (list, counts,
 *   row), keeps the later one active, and leaves a program's Session its own source; the
 *   machine's own reads (no adoption time) see every one as before.
 * - Given such a Session unarchived by the adopter, it stays in the list on every later read.
 * - Given an admin of the adopter, the archive groups include the machine's, marked with the
 *   machine and the time it counted them and named by the adopter's Project, and the total counts
 *   them; a member sees none of them, and naming the machine is a 404 that reaches nothing.
 * - Given a machine group, its page is the machine's, and a batch on it acts on the machine:
 *   unarchive by ids, and a whole-group delete pinned to the machine's own count time.
 * - Given a machine the adopter is not connected to, the groups name it as unreachable and still
 *   list this server's own; a page on it is a 503.
 * - Given a machine that holds its connection but answers nothing, this server's groups asked
 *   alone answer without it; the machines' groups are asked apart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type {
  ArchivedSessionGroupsResponse,
  ArchivedSessionsBatchResponse,
  ArchivedSessionsResponse,
  SessionResponse,
  SessionSource,
  SessionsResponse,
} from "../src/api/types.js";
import type { MachinesService } from "../src/machines/service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT = "default_agent";
const PROJECT = "default_project";
const DAY = "2026-10-14";
/** The machine's own id, and the alias the adopter reaches it by. */
const MACHINE = "QS7J4YVgSovi-Z2c";
const ALIAS = "box";
/** When the adopter first heard the machine's id. */
const ADOPTED = "2026-10-15T08:00:00.000Z";
const BEFORE = "2026-10-14T09:00:00.000Z";
const AFTER = "2026-10-15T09:00:00.000Z";

let seq = 0;
/** A Workspace no earlier attempt of a scenario wrote to: a retried scenario starts clean. */
const fresh = (name: string) => `/tmp/${name}-${++seq}`;

/** A Session as a process on `app` left it: its index row and a Trace whose head records `source`. */
async function seed(
  app: TestApp,
  opts: { at: string; source?: SessionSource; client?: "web" | "api"; workspace: string },
): Promise<string> {
  seq += 1;
  const n = String(seq).padStart(4, "0");
  const sessionId = `session-${DAY}-09-00-00-b8d2${n}`;
  const at = new Date(Date.parse(opts.at) + seq * 1000).toISOString();
  app.deps.sessionsRepo.insert({
    sessionId,
    projectId: PROJECT,
    agentId: AGENT,
    provider: "custom",
    modelId: "m-x",
    workspace: opts.workspace,
    approvalMode: "allow-all",
    title: null,
    client: opts.client ?? "web",
    hasTrace: true,
    createdAt: at,
    lastActiveAt: at,
  });
  const meta = {
    session_id: sessionId,
    model_id: "m-x",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: "/tmp/a",
    workspace: opts.workspace,
    source: opts.source ?? "user",
  };
  await writeTraceFile(app.root, PROJECT, AGENT, DAY, sessionId, 1, [
    sessionMeta(meta as Parameters<typeof sessionMeta>[0]),
    userText(`work ${n}`),
  ]);
  return sessionId;
}

async function json<T>(pending: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await pending;
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}

describe("a machine's Sessions, read by the server that adopted it", () => {
  let machine: TestApp;
  let adopter: TestApp;
  let machineCookie: string;
  let connected = true;
  /** The connection holds, and nothing behind it answers. */
  let silent = false;

  /** A call to the machine as the adopter makes one: its admin's session and the adoption time. */
  const asAdopter = async (method: string, path: string, body?: unknown) =>
    machine.app.request(path, {
      method,
      headers: {
        cookie: machineCookie,
        "x-penguin-adopted-at": ADOPTED,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    machine = await createTestApp();
    machineCookie = (await loginAdmin(machine.app)).cookie;
    // The adopter's machines node: the one machine its default Project uses, with a client to
    // that machine's API while it is connected. Whatever else the node offers is no part of
    // these scenarios, and says so if anything reaches for it.
    const used = {
      start: async () => {},
      stop: () => {},
      syncConfigEverywhere: async () => {},
      proxyTarget: async () => null,
      noteApiSeen: () => {},
      projectApis: async (projectId: string) =>
        projectId !== PROJECT
          ? []
          : [
              {
                machineId: MACHINE,
                alias: ALIAS,
                api: connected
                  ? {
                      request: async (method: string, path: string, body?: unknown) => {
                        if (silent) return new Promise<never>(() => {});
                        const res = await asAdopter(method, path, body);
                        return { status: res.status, text: await res.text() };
                      },
                    }
                  : null,
              },
            ],
    };
    const machines = new Proxy(used, {
      get: (target, key) =>
        key in target
          ? Reflect.get(target, key)
          : key === "then"
            ? undefined
            : () => {
                throw new Error(`machines.${String(key)} is not part of this suite`);
              },
    }) as unknown as MachinesService;
    adopter = await createTestApp({ machines });
  });
  afterAll(async () => {
    await adopter?.cleanup();
    await machine?.cleanup();
  });

  describe("the machine's own answers", () => {
    const list = (path: string, adopted: boolean) =>
      adopted ? asAdopter("GET", path) : apiClient(machine.app, machineCookie).get(path);
    const activeIds = async (adopted: boolean) =>
      (
        await json<SessionsResponse>(
          list(`/api/projects/${PROJECT}/agents/${AGENT}/sessions?category=active`, adopted),
        )
      ).sessions.map((s) => s.sessionId);
    const row = async (sessionId: string, adopted: boolean) =>
      (await json<SessionResponse>(list(`/api/sessions/${sessionId}`, adopted))).session;

    it("files a conversation from before the adoption away as a CLI task, for the adopter only", async () => {
      const workspace = fresh("adopt-own");
      const before = await seed(machine, { at: BEFORE, workspace });
      const after = await seed(machine, { at: AFTER, workspace });
      const apiBefore = await seed(machine, { at: BEFORE, source: "api", workspace });

      expect(await activeIds(true)).toContain(after);
      expect(await activeIds(true)).not.toContain(before);
      expect(await row(before, true)).toMatchObject({ source: "cli", archived: true });
      expect(await row(after, true)).toMatchObject({ source: "user", archived: false });
      expect(await row(apiBefore, true)).toMatchObject({ source: "api", archived: true });
      const counted = await json<SessionsResponse>(
        list(`/api/projects/${PROJECT}/agents/${AGENT}/sessions?category=active&counts=1`, true),
      );
      expect(counted.workspaceCounts?.[workspace]).toEqual({ active: 1, archived: 2 });

      // The machine's own pages and CLI see what they always saw.
      expect(await activeIds(false)).toEqual(expect.arrayContaining([before, after]));
      expect(await row(before, false)).toMatchObject({ source: "user", archived: false });
    });

    it("keeps one the adopter unarchived in the list on every later read", async () => {
      const before = await seed(machine, { at: BEFORE, workspace: fresh("adopt-kept") });
      const kept = await json<SessionResponse>(
        asAdopter("PATCH", `/api/sessions/${before}`, { archived: false }),
      );
      expect(kept.session).toMatchObject({ source: "cli", archived: false });
      expect(await activeIds(true)).toContain(before);
      expect(await activeIds(false)).toContain(before);
    });
  });

  describe("the adopter's archive page", () => {
    const groups = async (cookie: string, qs = "") =>
      json<ArchivedSessionGroupsResponse>(
        apiClient(adopter.app, cookie).get(`/api/me/archived-sessions/groups${qs}`),
      );
    const machineGroup = (body: ArchivedSessionGroupsResponse, workspace: string) =>
      body.groups.find((g) => g.machineId === MACHINE && g.workspace === workspace);

    it("lists the machine's archived groups beside this server's, marked with the machine", async () => {
      const admin = (await loginAdmin(adopter.app)).cookie;
      const workspace = fresh("adopt-list");
      await seed(machine, { at: BEFORE, workspace });
      await seed(machine, { at: AFTER, source: "cli", workspace });
      await seed(machine, { at: AFTER, workspace });
      await seed(adopter, { at: AFTER, source: "cli", workspace });

      const body = await groups(admin);
      const local = body.groups.find((g) => g.machineId === undefined && g.workspace === workspace);
      const remote = machineGroup(body, workspace);
      expect(local).toMatchObject({ projectId: PROJECT, count: 1 });
      expect(remote).toMatchObject({
        projectId: PROJECT,
        projectName: local!.projectName,
        count: 2,
        machineAlias: ALIAS,
      });
      expect(Number.isFinite(Date.parse(remote!.asOf ?? ""))).toBe(true);
      expect(body.total).toBe(body.groups.reduce((sum, g) => sum + g.count, 0));
      expect(body.unreachable).toBeUndefined();

      // The source filter is the machine's too: the conversation from before the adoption is CLI.
      expect(machineGroup(await groups(admin, "?source=cli"), workspace)?.count).toBe(2);
      expect(machineGroup(await groups(admin, "?source=user"), workspace)).toBeUndefined();
    });

    it("shows a member none of the machine's, and a page naming it reaches nothing", async () => {
      const member = await provisionUser(adopter.app, `adopt_member_${++seq}`);
      const body = await groups(member.cookie);
      expect(body.groups.some((g) => g.machineId !== undefined)).toBe(false);
      const ownProject = `${member.user.userId}-default_project`;
      const res = await apiClient(adopter.app, member.cookie).get(
        `/api/me/archived-sessions?projectId=${ownProject}&workspace=temp&limit=10&machineId=${MACHINE}`,
      );
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unknown_machine",
      );
    });

    it("reads a machine group's page from the machine, and acts on it there", async () => {
      const admin = apiClient(adopter.app, (await loginAdmin(adopter.app)).cookie);
      const workspace = fresh("adopt-act");
      const first = await seed(machine, { at: BEFORE, workspace });
      const second = await seed(machine, { at: BEFORE, workspace });
      const third = await seed(machine, { at: BEFORE, workspace });
      const group = `projectId=${PROJECT}&workspace=${encodeURIComponent(workspace)}`;

      const page = await json<ArchivedSessionsResponse>(
        admin.get(`/api/me/archived-sessions?${group}&limit=10&machineId=${MACHINE}`),
      );
      expect(page.sessions.map((s) => [s.sessionId, s.source])).toEqual([
        [third, "cli"],
        [second, "cli"],
        [first, "cli"],
      ]);

      const unarchived = await json<ArchivedSessionsBatchResponse>(
        admin.post("/api/me/archived-sessions/unarchive", {
          sessionIds: [first],
          machineId: MACHINE,
        }),
      );
      expect(unarchived.done).toBe(1);
      const firstNow = await json<SessionResponse>(asAdopter("GET", `/api/sessions/${first}`));
      expect(firstNow.session.archived).toBe(false);

      const counted = (await groups((await loginAdmin(adopter.app)).cookie)).groups.find(
        (g) => g.machineId === MACHINE && g.workspace === workspace,
      );
      expect(counted?.count).toBe(2);
      const deleted = await json<ArchivedSessionsBatchResponse>(
        admin.post("/api/me/archived-sessions/delete", {
          filter: { projectId: PROJECT, workspace, until: counted!.asOf },
          machineId: MACHINE,
        }),
      );
      expect(deleted.done).toBe(2);
      expect(machine.deps.sessionsRepo.findById(second)).toBeNull();
      expect(machine.deps.sessionsRepo.findById(third)).toBeNull();
      expect(machine.deps.sessionsRepo.findById(first)).not.toBeNull();
    });

    it("answers this server's groups alone without asking a machine, and the machines' apart", async () => {
      const admin = (await loginAdmin(adopter.app)).cookie;
      const workspace = fresh("adopt-apart");
      await seed(machine, { at: AFTER, source: "cli", workspace });
      await seed(adopter, { at: AFTER, source: "cli", workspace });
      silent = true;
      try {
        const here = await groups(admin, "?servers=here");
        expect(here.groups.some((g) => g.workspace === workspace && !g.machineId)).toBe(true);
        expect(here.groups.some((g) => g.machineId !== undefined)).toBe(false);
      } finally {
        silent = false;
      }
      const there = await groups(admin, "?servers=machines");
      expect(machineGroup(there, workspace)).toMatchObject({ count: 1 });
      expect(there.groups.some((g) => g.machineId === undefined)).toBe(false);
    });

    it("names a machine it cannot reach, lists its own all the same, and refuses a page there", async () => {
      const admin = (await loginAdmin(adopter.app)).cookie;
      const workspace = fresh("adopt-offline");
      await seed(adopter, { at: AFTER, source: "cli", workspace });
      connected = false;
      try {
        const body = await groups(admin);
        expect(body.unreachable).toEqual([{ machineId: MACHINE, alias: ALIAS }]);
        expect(body.groups.some((g) => g.machineId !== undefined)).toBe(false);
        expect(body.groups.some((g) => g.workspace === workspace)).toBe(true);
        const res = await apiClient(adopter.app, admin).get(
          `/api/me/archived-sessions?projectId=${PROJECT}&workspace=temp&limit=10&machineId=${MACHINE}`,
        );
        expect(res.status).toBe(503);
      } finally {
        connected = true;
      }
    });
  });
});
