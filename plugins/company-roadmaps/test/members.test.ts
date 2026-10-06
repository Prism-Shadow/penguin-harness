/**
 * `roadmap.members` (members.ts): the members replaced and the moderator named, each refusal of
 * the parameters, an append-only `members` event with both sides; the room following — while
 * the roadmap discusses a new member gets its room session and is told, a removed member's
 * session ends, the channel's employees change; in any other status only the channel changes —
 * the `moderator` approval taken only from the named moderator while approvals already given
 * stand; a roadmap never changed derives its moderator as before (an old `company.db` included);
 * and the default guard, which lets a person and the moderator through.
 */
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ROADMAP_SCHEMA,
  SqliteRoadmapStore,
  companyDbPath,
  readRoom,
  roadmapGuards,
  roadmapModerators,
  type Roadmap,
  type RoadmapService,
} from "../src/index.js";
import { BOSS, ORG, PROJECT, asAgent, orgDir, world, writeChannel, type World } from "./fakes.js";
import { actionApp, codeOf } from "./action-harness.js";

const BODY = "## The ledger\nOne file per organization.\n";
const ITEMS = [
  {
    key: "ledger",
    kind: "proposal",
    title: "Roadmap ledger",
    brief: "An append-only ledger.",
    owner: "acme_dev",
    cites: ["The ledger"],
  },
  {
    key: "pages",
    kind: "proposal",
    title: "Ledger pages",
    brief: "Pages over the ledger.",
    owner: "acme_web",
    cites: ["The ledger"],
    stackedOn: null,
  },
];
const OPEN = { name: "Queue", channelId: "room_a", employees: ["acme_dev", "acme_web"] };

let w: World;
let service: RoadmapService;

beforeEach(async () => {
  w = await world();
  service = w.service();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
});

async function opened(): Promise<Roadmap> {
  return (await service.create(PROJECT, ORG, OPEN, BOSS)).roadmap;
}

async function established(): Promise<Roadmap> {
  const r = await opened();
  await service.draft(PROJECT, ORG, r.number, { body: BODY, items: ITEMS }, BOSS);
  return (await service.establish(PROJECT, ORG, r.number, BOSS)).roadmap;
}

const members = (number: number, employees: unknown, moderator: unknown) =>
  service.members(PROJECT, ORG, number, { employees, moderator }, BOSS);

const roomMembers = async (): Promise<string[]> =>
  (await readRoom(orgDir(w.root), "room_a"))!.members;

describe("roadmap.members", () => {
  it("refuses an empty list, a repeat, a stranger, a member who left and a moderator outside the list", async () => {
    const r = await opened();
    const refusals: Array<[unknown, unknown, string]> = [
      [[], "acme_dev", "bad_request"],
      [["acme_dev", ""], "acme_dev", "bad_request"],
      [["acme_dev", "acme_dev"], "acme_dev", "bad_request"],
      [["acme_dev", "stranger"], "acme_dev", "not_an_employee"],
      [["acme_dev", "acme_web"], "acme_qa", "moderator_not_member"],
      [["acme_dev", "acme_web"], undefined, "bad_request"],
    ];
    for (const [employees, moderator, code] of refusals) {
      await expect(members(r.number, employees, moderator)).rejects.toMatchObject({
        status: 400,
        code,
      });
    }
    // An employee who left the organization is not one any more.
    w.gateway.org = {
      ...w.gateway.org,
      employees: w.gateway.org.employees.filter((e) => e.agentId !== "acme_web"),
    };
    await expect(members(r.number, ["acme_web"], "acme_web")).rejects.toMatchObject({
      status: 400,
      code: "not_an_employee",
    });
    // Nothing was written, and the room was not touched.
    const after = await service.get(PROJECT, ORG, r.number, BOSS);
    expect(after.events.some((e) => e.kind === "members")).toBe(false);
    expect(w.gateway.memberChanges).toEqual([]);
  });

  it("records an append-only members event with the members and moderator before and after", async () => {
    const r = await opened();
    const { roadmap } = await members(r.number, ["acme_web", "acme_qa"], "acme_qa");
    expect(roadmap).toMatchObject({
      employees: ["acme_web", "acme_qa"],
      explicitModerator: "acme_qa",
      moderator: "acme_qa",
    });
    expect(roadmap.events.filter((e) => e.kind === "members")).toMatchObject([
      {
        by: "user:boss",
        note: "acme_dev, acme_web (moderator acme_dev) → acme_web, acme_qa (moderator acme_qa)",
      },
    ]);
    const store = SqliteRoadmapStore.open(companyDbPath(w.root, PROJECT, ORG));
    try {
      expect(() =>
        store.db.exec(`UPDATE roadmap_events SET note = 'x' WHERE kind = 'members'`),
      ).toThrow(/history_append_only/);
      expect(() => store.db.exec(`DELETE FROM roadmap_events WHERE kind = 'members'`)).toThrow(
        /history_append_only/,
      );
    } finally {
      store.close();
    }
  });

  it("while discussing: a new member gets its room session and is told, a removed member's session ends, the channel follows", async () => {
    const r = await opened();
    expect(r.clones.map((c) => [c.agentId, c.sessionId])).toEqual([
      ["acme_dev", "room-1"],
      ["acme_web", "room-2"],
    ]);
    const desks = w.gateway.desks.length;
    const { roadmap, hints } = await members(r.number, ["acme_web", "acme_qa"], "acme_qa");
    expect(hints).toEqual([]);
    expect(w.gateway.memberChanges).toEqual([
      { channelId: "room_a", by: "user:boss", add: ["acme_qa"], remove: ["acme_dev"] },
    ]);
    expect(await roomMembers()).toEqual(["user:boss", "agent:acme_web", "agent:acme_qa"]);
    const open = roadmap.clones.filter((c) => c.closedAt === undefined);
    expect(open.map((c) => [c.agentId, c.sessionId])).toEqual([
      ["acme_web", "room-2"],
      ["acme_qa", "room-3"],
    ]);
    expect(roadmap.clones.find((c) => c.sessionId === "room-1")?.closedAt).toBeDefined();
    // The new session starts as an opening's does, knowing it moderates.
    expect(w.gateway.opened.at(-1)).toMatchObject({ agentId: "acme_qa", sessionId: "room-3" });
    expect(w.gateway.opened.at(-1)!.body).toContain("Moderator: acme_qa (you).");
    expect(w.gateway.desks.slice(desks)).toEqual([
      {
        agentId: "acme_qa",
        text: "[roadmap #1 «Queue»] user:boss made you a member of this roadmap, in its room `room_a` (you moderate). Your room session `room-3` takes part; nothing is needed from this desk, and do not speak in the room from here.",
      },
    ]);
  });

  it("in any other status changes only the channel: no session opens or closes, nobody is told", async () => {
    const r = await established();
    const desks = w.gateway.desks.length;
    const sessions = w.gateway.opened.length;
    const { roadmap } = await members(r.number, ["acme_dev", "acme_qa"], "acme_dev");
    expect(await roomMembers()).toEqual(["user:boss", "agent:acme_dev", "agent:acme_qa"]);
    expect(w.gateway.opened).toHaveLength(sessions);
    expect(w.gateway.desks).toHaveLength(desks);
    expect(roadmap.clones.filter((c) => c.closedAt === undefined).map((c) => c.agentId)).toEqual([
      "acme_dev",
      "acme_web",
    ]);
    expect(roadmap.employees).toEqual(["acme_dev", "acme_qa"]);
  });

  it("a roadmap without a room changes its members alone", async () => {
    // A derived roadmap whose room could not be opened, waiting for one.
    const store = SqliteRoadmapStore.open(companyDbPath(w.root, PROJECT, ORG));
    store.write({
      kind: "opened",
      number: 1,
      name: "Waiting",
      brief: "",
      channelId: null,
      employees: ["acme_dev"],
      parent: null,
      by: "user:boss",
    });
    store.close();
    const { roadmap } = await members(1, ["acme_qa"], "acme_qa");
    expect(roadmap).toMatchObject({ status: "awaiting_room", employees: ["acme_qa"] });
    expect(w.gateway.memberChanges).toEqual([]);
    expect(w.gateway.opened).toEqual([]);
  });

  it("refuses the change when the room cannot follow, and records nothing", async () => {
    const r = await opened();
    w.gateway.refuseMemberChanges = "This organization runs on machine m2.";
    await expect(members(r.number, ["acme_qa"], "acme_qa")).rejects.toMatchObject({
      status: 409,
      code: "org_runs_elsewhere",
    });
    const after = await service.get(PROJECT, ORG, r.number, BOSS);
    expect(after.employees).toEqual(["acme_dev", "acme_web"]);
    expect(after.explicitModerator).toBeNull();
  });

  it("takes the moderator approval only from the named moderator; approvals given before stand", async () => {
    const r = await established();
    const approve = (key: string, actor = BOSS) =>
      service.approve(PROJECT, ORG, r.number, key, actor);
    // Before: acme_dev moderates (derived) and approves ledger as moderator; a person approves
    // pages as a member.
    await approve("ledger", asAgent("acme_dev"));
    await approve("pages", BOSS);
    await members(r.number, ["acme_dev", "acme_web", "acme_qa"], "acme_qa");
    const now = await service.get(PROJECT, ORG, r.number, BOSS);
    expect(now.delegations.ledger!.approvals.moderator).toMatchObject({ by: "agent:acme_dev" });
    expect(now.delegations.pages!.approvals.member).toMatchObject({ by: "user:boss" });
    // acme_dev no longer moderates: pages waits for acme_qa's approval, not its.
    await expect(approve("pages", asAgent("acme_dev"))).rejects.toMatchObject({ status: 409 });
    const done = await approve("pages", asAgent("acme_qa"));
    expect(done.roadmap.delegations.pages).toMatchObject({
      stage: "delegated",
      approvals: { moderator: { by: "agent:acme_qa" }, member: { by: "user:boss" } },
    });
    // The old moderator's approval of ledger still counts: a member's completes it.
    const ledger = await approve("ledger", asAgent("acme_web"));
    expect(ledger.roadmap.delegations.ledger).toMatchObject({ stage: "delegated" });
    expect(w.proposals.created.map((p) => p.roadmap.key)).toEqual(["pages", "ledger"]);
  });

  it("leaves the derivation of a roadmap never changed as it was, and an explicit moderator stays put", async () => {
    const r = await opened();
    expect(r).toMatchObject({ explicitModerator: null, moderator: "acme_dev" });
    // acme_dev's room session is gone and, the organization paused, none opens in its place:
    // the first member with an open one moderates, as before.
    w.gateway.org = { ...w.gateway.org, status: "paused" };
    w.sessions.deleted.add("room-1");
    await service.relayOnce();
    expect((await service.get(PROJECT, ORG, r.number, BOSS)).moderator).toBe("acme_web");
    // Named, it moderates whether or not it has a session.
    const { roadmap } = await members(r.number, ["acme_dev", "acme_web"], "acme_dev");
    expect(roadmap.moderator).toBe("acme_dev");
    expect(roadmap.clones.filter((c) => c.closedAt === undefined).map((c) => c.agentId)).toEqual([
      "acme_web",
    ]);
  });

  it("opens a company.db written before the moderator column: the column is added, old rows read null", async () => {
    const old = ROADMAP_SCHEMA.replace(
      "  body        TEXT NOT NULL DEFAULT '',\n  moderator   TEXT\n",
      "  body        TEXT NOT NULL DEFAULT ''\n",
    );
    expect(old).not.toBe(ROADMAP_SCHEMA);
    const file = path.join(w.root, "old-company.db");
    const sqlite = process.getBuiltinModule("node:sqlite");
    const db = new sqlite.DatabaseSync(file);
    db.exec(old);
    db.exec(`INSERT INTO roadmaps (number, name, status, channel_id, employees, created_by,
      created_at, updated_at, seq, brief) VALUES (1, 'Old', 'discussing', 'room_a',
      '["acme_web","acme_dev"]', 'user:boss', 't', 't', 1, '')`);
    db.close();
    const store = SqliteRoadmapStore.open(file);
    try {
      const r = store.get(1)!;
      expect(r.explicitModerator).toBeNull();
      store.write({
        kind: "members",
        number: 1,
        employees: ["acme_dev"],
        moderator: "acme_dev",
        before: { employees: r.employees, moderator: "acme_web" },
        by: "user:boss",
      });
      expect(store.get(1)!.explicitModerator).toBe("acme_dev");
    } finally {
      store.close();
    }
    // Opened again, the column is there already and nothing changes.
    const again = SqliteRoadmapStore.open(file);
    expect(again.get(1)!.explicitModerator).toBe("acme_dev");
    again.close();
  });
});

describe("the default guard of roadmap.members", () => {
  const answer = (state: Roadmap, agentId: string | null): string => {
    try {
      roadmapGuards["roadmap.members"]!({
        caller: {
          principal: agentId === null ? "user:boss" : `agent:${agentId}`,
          agentId,
          userId: "boss",
        },
        subject: { kind: "roadmap", id: String(state.number), text: `roadmap:${state.number}` },
        state,
        params: {},
        running: 0,
      });
      return "allowed";
    } catch (err) {
      return (err as { code: string }).code;
    }
  };

  it("lets a person and the moderator through and refuses any other employee", async () => {
    const r = await opened();
    expect(answer(r, null)).toBe("allowed");
    expect(answer(r, "acme_dev")).toBe("allowed");
    expect(answer(r, "acme_web")).toBe("not_moderator");
    expect(answer(r, "acme_qa")).toBe("not_moderator");
    // Once named, the named moderator is the one let through.
    const { roadmap } = await members(r.number, ["acme_dev", "acme_web"], "acme_web");
    expect(answer(roadmap, "acme_web")).toBe("allowed");
    expect(answer(roadmap, "acme_dev")).toBe("not_moderator");
  });

  it("runs through the Action route as an ActionRun, refused for an employee who does not moderate", async () => {
    const a = actionApp({ gateway: w.gateway, root: w.root, service });
    const r = await opened();
    const params = { employees: ["acme_dev", "acme_web", "acme_qa"], moderator: "acme_dev" };
    const refused = await a.run(
      "roadmap.members",
      `roadmap:${r.number}`,
      params,
      asAgent("acme_web"),
    );
    expect([refused.status, codeOf(refused)]).toEqual([403, "not_moderator"]);
    const ran = await a.run("roadmap.members", `roadmap:${r.number}`, params, asAgent("acme_dev"));
    expect(ran.status).toBe(200);
    expect(ran.body.run).toMatchObject({
      contribution: "company-roadmaps.action.members",
      subject: `roadmap:${r.number}`,
      by: "agent:acme_dev",
      outcome: "succeeded",
    });
    const runs = (await a.get(`/p/${PROJECT}/o/${ORG}/actions/runs?key=roadmap.members`)).body
      .runs as Array<{ by: string; outcome: string }>;
    expect(runs.filter((x) => x.outcome === "succeeded").map((x) => x.by)).toEqual([
      "agent:acme_dev",
    ]);
    const bad = await a.run("roadmap.members", `roadmap:${r.number}`, {
      employees: [],
      moderator: "acme_dev",
    });
    expect([bad.status, codeOf(bad)]).toEqual([400, "bad_request"]);
  });
});

describe("the moderators company-proposals asks for", () => {
  it("answer the moderator a roadmap has now, derived or named, and null for no roadmap", async () => {
    const moderatorOf = roadmapModerators(service);
    const r = await opened();
    expect(await moderatorOf(PROJECT, ORG, r.number, BOSS)).toBe("acme_dev");
    await members(r.number, ["acme_dev", "acme_web"], "acme_web");
    expect(await moderatorOf(PROJECT, ORG, r.number, BOSS)).toBe("acme_web");
    expect(await moderatorOf(PROJECT, ORG, 99, BOSS)).toBeNull();
  });
});
