/**
 * One bot on one server: which server has a messaging bot enabled, as a server that connects
 * machines answers it for its Project, and as a machine answers the server that asks.
 *
 * Two apps: the machine (its own Sessions, bindings and admin) and the server that connects it,
 * whose machines node hands out a client to the machine's real routes, called with the machine
 * admin's session the way machines/service.ts projectApis builds one. A scenario that needs a
 * machine on an older build, or one whose answer fails, adds it beside the first. Bots are saved
 * and enabled through the binding routes, over the suite's Feishu SDK fake.
 *
 * - Given a bot enabled on a Session of this server, the holders answer names this server and
 *   no Session.
 * - Given a bot enabled on a Session of the machine, the answer names the machine by its alias.
 * - Given that, the machine's accounts route answers its admin with the enabled account only,
 *   with no secret and no Session id, and refuses anyone else.
 * - Given the same bot saved on both servers and enabled on neither, nobody holds it.
 * - Given a bot left enabled on a Session that no longer exists, nobody holds it.
 * - Given a machine this server is not connected to, it is listed as not connected, and this
 *   server's own answer still comes.
 * - Given a machine whose build has no accounts route, it is listed as an older build; given one
 *   whose answer fails (dropped, an error status, not the accounts list), it is listed as failed;
 *   either way the other machine's answer still counts.
 * - Given a member of the Project who is not an admin, the answer is about this server alone and
 *   no machine is asked; someone outside the Project gets 404.
 * - Given a missing or unknown channel, or an empty account id, the answer is 400.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MessagingAccountHoldersResponse } from "../src/api/types.js";
import { FakeFeishuSdk } from "./fixtures/feishu.js";
import { appApi, fakeMachinesNode } from "./fixtures/machines.js";
import type { FleetMachineDouble } from "./fixtures/machines.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";
/** The machine's own id, and the alias this server reaches it by. */
const MACHINE = "QS7J4YVgSovi-Z2c";
const ALIAS = "box";
const SECRET = "feishu-secret-value-0001";

let seq = 0;
/** A Feishu app id no earlier scenario used. */
const nextAppId = () => `cli_fleet_${String(++seq).padStart(4, "0")}`;

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("which server has a messaging bot enabled", () => {
  let machine: TestApp;
  let adopter: TestApp;
  let machineAdmin: string;
  let adopterAdmin: string;
  /** Whether this server holds a connection to the machine. */
  let connected = true;
  /** Further machines of the Project in a scenario: an older build, a failing one. */
  let others: FleetMachineDouble[] = [];
  /** Every request this server made to a machine, by alias. */
  let asked: string[] = [];

  const recorded = (m: FleetMachineDouble): FleetMachineDouble => ({
    ...m,
    api:
      m.api === null
        ? null
        : {
            request: (method, path, body) => {
              asked.push(m.alias);
              return m.api!.request(method, path, body);
            },
          },
  });

  /** A Session on `app` with the bot saved, and turned on unless `enabled` is false. */
  const bot = async (app: TestApp, cookie: string, appId: string, enabled = true) => {
    const { sessionId } = adoptSession(app.deps, fakeSession(uniqueSessionId()));
    const api = apiClient(app.app, cookie);
    const base = `/api/sessions/${sessionId}/messaging/feishu`;
    expect((await api.put(base, { appId, appSecret: SECRET })).status).toBe(200);
    if (enabled) expect((await api.post(`${base}/state`, { enabled: true })).status).toBe(200);
    return sessionId;
  };

  const holders = (cookie: string, query: string) =>
    apiClient(adopter.app, cookie).get(
      `/api/projects/${PROJECT}/messaging/account-holders?${query}`,
    );
  const holdersOf = async (appId: string, cookie = adopterAdmin) => {
    const res = await holders(cookie, `channel=feishu&accountId=${encodeURIComponent(appId)}`);
    expect(res.status).toBe(200);
    return (await res.json()) as MessagingAccountHoldersResponse;
  };

  beforeAll(async () => {
    machine = await createTestApp({ feishuSdk: new FakeFeishuSdk() });
    machineAdmin = (await loginAdmin(machine.app)).cookie;
    adopter = await createTestApp({
      feishuSdk: new FakeFeishuSdk(),
      machines: fakeMachinesNode((projectId) =>
        projectId !== PROJECT
          ? []
          : [
              {
                machineId: MACHINE,
                alias: ALIAS,
                api: connected ? appApi(machine.app, machineAdmin) : null,
              },
              ...others,
            ].map(recorded),
      ),
    });
    adopterAdmin = (await loginAdmin(adopter.app)).cookie;
  });
  afterEach(() => {
    connected = true;
    others = [];
    asked = [];
    // What a scenario turned on goes with it, connection and all.
    for (const app of [machine, adopter]) {
      for (const row of app.deps.messagingRepo.listAll()) {
        app.deps.messaging.unbindSession(row.sessionId);
      }
    }
  });
  afterAll(async () => {
    await adopter?.cleanup();
    await machine?.cleanup();
  });

  it("names this server for a bot enabled on one of its Sessions, and no Session", async () => {
    const appId = nextAppId();
    const sessionId = await bot(adopter, adopterAdmin, appId);

    const res = await holders(adopterAdmin, `channel=feishu&accountId=${appId}`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      holders: [{ machineId: null, alias: null }],
      unreachable: [],
    });
    expect(text).not.toContain(sessionId);
  });

  it("names the machine by its alias for a bot enabled on one of the machine's Sessions", async () => {
    const appId = nextAppId();
    await bot(machine, machineAdmin, appId);

    expect(await holdersOf(appId)).toEqual({
      holders: [{ machineId: MACHINE, alias: ALIAS }],
      unreachable: [],
    });
  });

  it("answers the machine's admin with its enabled accounts and nothing else, and refuses anyone else", async () => {
    const enabled = nextAppId();
    const sessionId = await bot(machine, machineAdmin, enabled);
    await bot(machine, machineAdmin, nextAppId(), false);

    const res = await apiClient(machine.app, machineAdmin).get("/api/messaging/accounts");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ accounts: [{ channel: "feishu", accountId: enabled }] });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(sessionId);

    const member = await provisionUser(machine.app, `fleet_member_${++seq}`);
    const refused = await apiClient(machine.app, member.cookie).get("/api/messaging/accounts");
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("admin_required");
  });

  it("names nobody for a bot saved on both servers and enabled on neither", async () => {
    const appId = nextAppId();
    await bot(adopter, adopterAdmin, appId, false);
    await bot(machine, machineAdmin, appId, false);

    expect(await holdersOf(appId)).toEqual({ holders: [], unreachable: [] });
  });

  it("names nobody for a bot left enabled on a Session that no longer exists", async () => {
    const appId = nextAppId();
    const sessionId = await bot(adopter, adopterAdmin, appId);
    // Gone the way a bulk Agent or Project delete leaves it: the index row, not the binding.
    adopter.deps.sessionsRepo.deleteById(sessionId);

    expect(await holdersOf(appId)).toEqual({ holders: [], unreachable: [] });
  });

  it("lists a machine it is not connected to as not connected, and still answers for itself", async () => {
    const appId = nextAppId();
    await bot(adopter, adopterAdmin, appId);
    connected = false;

    expect(await holdersOf(appId)).toEqual({
      holders: [{ machineId: null, alias: null }],
      unreachable: [{ machineId: MACHINE, alias: ALIAS, reason: "not_connected" }],
    });
  });

  it("lists a machine whose build has no accounts route as an older build", async () => {
    const appId = nextAppId();
    await bot(machine, machineAdmin, appId);
    // What a build from before the route answers for it: the platform's own not-found.
    const notFound = JSON.stringify({
      error: { code: "not_found", message: "Endpoint does not exist." },
    });
    others = [
      {
        machineId: "older-build-0001",
        alias: "old",
        api: { request: async () => ({ status: 404, text: notFound }) },
      },
    ];

    expect(await holdersOf(appId)).toEqual({
      holders: [{ machineId: MACHINE, alias: ALIAS }],
      unreachable: [{ machineId: "older-build-0001", alias: "old", reason: "older_build" }],
    });
  });

  it.each([
    [
      "drops the connection",
      async () => {
        throw new Error("the machine's server closed mid-answer");
      },
    ],
    ["answers an error status", async () => ({ status: 500, text: "{}" })],
    [
      "answers something other than the accounts list",
      async () => ({ status: 200, text: "<html>" }),
    ],
  ])("lists a machine that %s as failed", async (_what, answer) => {
    const appId = nextAppId();
    await bot(machine, machineAdmin, appId);
    others = [{ machineId: "failing-0001", alias: "flaky", api: { request: answer } }];

    expect(await holdersOf(appId)).toEqual({
      holders: [{ machineId: MACHINE, alias: ALIAS }],
      unreachable: [{ machineId: "failing-0001", alias: "flaky", reason: "failed" }],
    });
  });

  it("answers a member who is not an admin for this server alone, and someone outside not at all", async () => {
    const appId = nextAppId();
    await bot(adopter, adopterAdmin, appId);
    await bot(machine, machineAdmin, appId);
    const member = await provisionUser(adopter.app, `fleet_member_${++seq}`);
    const added = await apiClient(adopter.app, adopterAdmin).post(
      `/api/projects/${PROJECT}/members`,
      { userId: member.user.userId },
    );
    expect(added.status).toBe(201);

    expect(await holdersOf(appId, member.cookie)).toEqual({
      holders: [{ machineId: null, alias: null }],
      unreachable: [],
    });
    expect(asked).toEqual([]);
    // An admin asking the same is answered for the machine too.
    expect((await holdersOf(appId)).holders).toEqual([
      { machineId: null, alias: null },
      { machineId: MACHINE, alias: ALIAS },
    ]);

    const stranger = await provisionUser(adopter.app, `fleet_stranger_${++seq}`);
    const refused = await holders(stranger.cookie, `channel=feishu&accountId=${appId}`);
    expect(refused.status).toBe(404);
    expect(await errorCode(refused)).toBe("project_not_found");
  });

  it.each([
    ["no channel", "accountId=cli_any"],
    ["an unknown channel", "channel=slack&accountId=cli_any"],
    ["an empty account id", "channel=feishu&accountId=%20"],
  ])("refuses a question with %s", async (_what, query) => {
    const res = await holders(adopterAdmin, query);
    expect(res.status).toBe(400);
    expect(asked).toEqual([]);
  });
});
