/**
 * The service over the gateway, session-runtime and session-index fakes and a real directory:
 * a person opens a roadmap over a room; every employee in it gets a room session (its desk
 * cloned for the room) and the room's messages reach those sessions — never a desk; the
 * moderator drafts; establishing ends the discussion (proposal items stay briefs until they have
 * their approvals — the moderator's and another member's by default —, a roadmap item derives its
 * roadmap); an owner links its proposal
 * and the one stacked on it learns the number; an owner reopens it. Nothing here starts a
 * server or a Session.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  RoadmapError,
  SqliteRoadmapStore,
  companyDbPath,
  roadmapGuards,
  withApprovalRoles,
  type RoadmapService,
  type WriteAct,
} from "../src/index.js";
import { BOSS, ORG, PROJECT, asAgent, post, world, writeChannel, type World } from "./fakes.js";

const P = PROJECT;
const O = ORG;

async function refusal(run: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run;
  } catch (err) {
    if (err instanceof RoadmapError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

/** Every roadmap event of the organization, in the order written, read from its store on disk. */
async function eventsOf(
  root: string,
): Promise<Array<{ kind: string; number: number; by: string; note?: string }>> {
  const store = SqliteRoadmapStore.open(companyDbPath(root, P, O));
  try {
    return store
      .list()
      .flatMap((r) => r.events.map((e) => ({ ...e, number: r.number })))
      .sort((a, b) => a.seq - b.seq);
  } finally {
    store.close();
  }
}

const BODY = `# Queue migration

## Why
The queue lost its history.

## The ledger
One file per organization.

## The page
A side panel.
`;

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
    key: "page",
    kind: "proposal",
    title: "Side panel",
    brief: "The draft beside the room.",
    owner: "acme_web",
    cites: ["the page"],
  },
  {
    key: "tests",
    kind: "roadmap",
    title: "Test plan",
    brief: "How it is tested.",
    employees: ["acme_qa", "acme_dev"],
    cites: ["Why"],
  },
];

let w: World;
let service: RoadmapService;

beforeEach(async () => {
  w = await world();
  service = w.service();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
});

const OPEN_A = {
  name: "Queue migration",
  channelId: "room_a",
  employees: ["acme_dev", "acme_web"],
  brief: "Move the queue",
};

/** Roadmap A opened over room_a; the desk lines the opening puts are taken off, so a test sees only what follows. */
async function openA(): Promise<number> {
  const { roadmap } = await service.create(P, O, OPEN_A, BOSS);
  w.gateway.desks = [];
  return roadmap.number;
}

describe("opening a roadmap", () => {
  it("clones the desk of every employee in the room — a session each, the first moderating — and tells each desk where it is", async () => {
    const n = (await service.create(P, O, OPEN_A, BOSS)).roadmap.number;
    expect(w.gateway.opened.map((s) => s.agentId)).toEqual(["acme_dev", "acme_web"]);
    // One line on each desk, after the room sessions opened: the room, who moderates, the
    // session that takes part — and that the desk itself says nothing there.
    expect(w.gateway.desks).toEqual([
      {
        agentId: "acme_dev",
        text: `[roadmap #${n} «Queue migration»] user:boss opened this roadmap and put you in its room \`room_a\` (you moderate). Your room session \`room-1\` takes part; nothing is needed from this desk, and do not speak in the room from here.`,
      },
      {
        agentId: "acme_web",
        text: `[roadmap #${n} «Queue migration»] user:boss opened this roadmap and put you in its room \`room_a\` (acme_dev moderates). Your room session \`room-2\` takes part; nothing is needed from this desk, and do not speak in the room from here.`,
      },
    ]);
    const [dev, web] = w.gateway.opened;
    expect(dev?.title).toBe(`Queue migration · roadmap #${n}`);
    expect(dev?.body).toContain("Moderator: acme_dev (you)");
    expect(dev?.body).toContain("penguin org channel send --org-id acme --channel room_a");
    expect(dev?.body).toContain("/actions/roadmap.draft/runs");
    expect(web?.body).toContain("Moderator: acme_dev.");
    expect(web?.body).not.toContain("roadmap.establish");
    // Every room session is told the room comes to it — so it does not wait for the room.
    for (const s of [dev, web]) {
      expect(s?.body).toContain(
        "do not poll the channel's files, sleep in a loop or wait in a command for an answer",
      );
    }
    // Establishing ends the discussion; the moderator is not told the roadmap is archived.
    expect(dev?.body).toContain("When the room agrees, establish it — every roadmap item derives");
    expect(dev?.body).not.toMatch(/archiv/i);
    const r = await service.get(P, O, n, BOSS);
    expect(r).toMatchObject({ status: "discussing", moderator: "acme_dev" });
    expect(r.openClones).toEqual([
      { agentId: "acme_dev", sessionId: "room-1" },
      { agentId: "acme_web", sessionId: "room-2" },
    ]);
  });

  it("opens with the person who opened it: the moderator speaks to them first, the others hold back", async () => {
    await openA();
    const [dev, web] = w.gateway.opened;
    expect(dev?.body).toContain(
      "Open the room: user:boss (a person) opened this roadmap. Before anything else, send one message in the room to @user:boss",
    );
    expect(web?.body).toContain(
      "The room opens with acme_dev and user:boss (the person who opened it) settling the question. Until one of them speaks to you, take the room in and do not answer.",
    );
    // A room session opened after the moderator has spoken joins a room already under way.
    await post(w.root, "room_a", "agent:acme_dev", "@user:boss what do you want from this?");
    w.sessions.deleted.add("room-2");
    await service.relayOnce();
    const again = w.gateway.opened.at(-1)!;
    expect(again.agentId).toBe("acme_web");
    expect(again.body).not.toContain("do not answer");
    expect(again.body).toContain("what do you want from this?");
  });

  it("starts a room session on the room so far", async () => {
    await post(w.root, "room_a", "user:boss", "Let us plan the queue");
    await openA();
    expect(w.gateway.opened[0]?.body).toContain("user:boss: Let us plan the queue");
    // …and does not relay it a second time.
    await service.relayOnce();
    expect(w.runner.inputs).toEqual([]);
  });

  it("answers the opening even when the pass after it fails, says so, and the next pass catches up", async () => {
    let calls = 0;
    const real = w.gateway.organization.bind(w.gateway);
    w.gateway.organization = async () => {
      calls++;
      if (calls === 2) throw new Error("disk hiccup");
      return real();
    };
    const { roadmap, hints } = await service.create(
      P,
      O,
      { name: "Queue migration", channelId: "room_a", employees: ["acme_dev"] },
      BOSS,
    );
    expect(roadmap.status).toBe("discussing");
    expect(hints).toEqual(["The room was not relayed this time: disk hiccup"]);
    expect(w.gateway.opened).toEqual([]);
    await service.relayOnce();
    expect(w.gateway.opened.map((s) => s.agentId)).toEqual(["acme_dev", "acme_web"]);
  });

  it("is opened by an employee a person asked to: its own room, the employees named in it, the opener recorded", async () => {
    const { roadmap } = await service.create(
      P,
      O,
      { name: "Queue migration", employees: ["acme_dev", "acme_web"], brief: "Move the queue" },
      asAgent("acme_dev"),
    );
    const n = roadmap.number;
    expect(roadmap).toMatchObject({
      status: "discussing",
      createdBy: "agent:acme_dev",
      channelId: `roadmap_${n}`,
      moderator: "acme_dev",
    });
    // The room is opened in the employee's name, with the employees it named — no one else.
    expect(w.gateway.rooms).toEqual([
      {
        projectId: P,
        orgId: O,
        channelId: `roadmap_${n}`,
        name: "Queue migration",
        purpose: `Roadmap #${n} — Move the queue`,
        by: "agent:acme_dev",
        agentIds: ["acme_dev", "acme_web"],
      },
    ]);
    expect(w.gateway.opened.map((s) => s.agentId)).toEqual(["acme_dev", "acme_web"]);
    expect(w.gateway.desks.map((d) => d.text)).toEqual([
      expect.stringContaining("agent:acme_dev opened this roadmap and put you in its room"),
      expect.stringContaining("agent:acme_dev opened this roadmap and put you in its room"),
    ]);
    // No person opened it, so no room session is told to wait for one.
    for (const s of w.gateway.opened) expect(s.body).not.toContain("(a person) opened");
    // Over an existing channel, an employee is held to the same room check a person is.
    expect(
      await refusal(
        service.create(
          P,
          O,
          { name: "x", channelId: "room_a", employees: ["acme_qa"] },
          asAgent("acme_dev"),
        ),
      ),
    ).toEqual({ status: 400, code: "not_in_room" });
  });

  it("refuses a room without the employees, or no room", async () => {
    expect(
      await refusal(
        service.create(P, O, { name: "x", channelId: "room_a", employees: ["acme_qa"] }, BOSS),
      ),
    ).toEqual({ status: 400, code: "not_in_room" });
    expect(
      await refusal(
        service.create(P, O, { name: "x", channelId: "room_z", employees: ["acme_dev"] }, BOSS),
      ),
    ).toEqual({ status: 400, code: "room_not_found" });
    expect(
      await refusal(
        service.create(P, O, { name: "x", channelId: "room_a", employees: ["nobody"] }, BOSS),
      ),
    ).toMatchObject({ status: 400 });
  });

  it("answers 404 while company mode is off", async () => {
    w.gateway.enabled = false;
    expect(await refusal(service.list(P, O, BOSS))).toEqual({ status: 404, code: "not_found" });
  });
});

describe("the room", () => {
  it("puts every room message into the other members' room sessions — never onto a desk", async () => {
    await openA();
    await post(w.root, "room_a", "user:boss", "What goes first?");
    await service.relayOnce();
    expect(w.runner.to("room-1")).toHaveLength(1);
    expect(w.runner.to("room-1")[0]).toContain("user:boss");
    expect(w.runner.to("room-1")[0]).toContain("What goes first?");
    expect(w.runner.to("room-2")).toHaveLength(1);
    await post(w.root, "room_a", "agent:acme_dev", "The ledger.");
    await service.relayOnce();
    expect(w.runner.to("room-1")).toHaveLength(1);
    expect(w.runner.to("room-2")).toHaveLength(2);
    expect(w.gateway.desks).toEqual([]);
  });

  it("reaches a room session busy with a long Task at once — steered into it, not queued behind it", async () => {
    await openA();
    // The moderator's session never ended the Task it opened with (it waits on the room in a
    // loop of its own): a message queued behind that Task would not reach it.
    w.runner.running.add("room-1");
    await post(w.root, "room_a", "user:boss", "@acme_dev here is the scope");
    await service.relayOnce();
    expect(w.runner.inputs.filter((i) => i.sessionId === "room-1")).toEqual([
      expect.objectContaining({ how: "steered" }),
    ]);
    expect(w.runner.to("room-1")[0]).toContain("here is the scope");
    // The idle one starts a Task on it, as before.
    expect(w.runner.inputs.filter((i) => i.sessionId === "room-2")).toEqual([
      expect.objectContaining({ how: "started" }),
    ]);
  });

  it("starts the line as the next Task when the running one ends before it lands", async () => {
    const n = await openA();
    w.runner.running.add("room-1");
    w.runner.finishing.add("room-1");
    await post(w.root, "room_a", "user:boss", "still there?");
    await service.relayOnce();
    expect(w.runner.inputs.filter((i) => i.sessionId === "room-1")).toEqual([
      expect.objectContaining({ how: "started" }),
    ]);
    // Taken, so the session stays open.
    expect((await service.get(P, O, n, BOSS)).openClones.map((c) => c.sessionId)).toEqual([
      "room-1",
      "room-2",
    ]);
  });

  it("is relayed where the organization runs: from a mirror of it nothing is closed, opened or sent", async () => {
    const n = await openA();
    // This server now holds only a mirror (the organization runs on another machine): the room
    // sessions are that machine's, so none of them is found here.
    w.gateway.org = { ...w.gateway.org, machineId: "machine-b" };
    w.sessions.deleted.add("room-1");
    w.sessions.deleted.add("room-2");
    await post(w.root, "room_a", "user:boss", "said over there");
    await service.relayOnce();
    // …nor after a restart here (a push), which loads the copied ledger afresh.
    await w.service().relayOnce();
    const r = await w.service().get(P, O, n, BOSS);
    expect(r.clones.every((c) => c.closedAt === undefined)).toBe(true);
    expect(r.openClones.map((c) => c.sessionId)).toEqual(["room-1", "room-2"]);
    expect(w.gateway.opened).toHaveLength(2);
    expect(w.runner.inputs).toEqual([]);
  });

  it("relays as before on a server older than OrgView.machineId, which does not say where the organization runs", async () => {
    await openA();
    // That server's view has no such field: absent, not null.
    const older: Record<string, unknown> = { ...w.gateway.org };
    delete older.machineId;
    w.gateway.org = older as unknown as typeof w.gateway.org;
    await post(w.root, "room_a", "user:boss", "still relayed?");
    await service.relayOnce();
    expect(w.runner.to("room-1")).toHaveLength(1);
    expect(w.runner.to("room-2")).toHaveLength(1);
  });

  it("starts the line on a server older than MessagingTaskRunner.steer, even for a running room session", async () => {
    await openA();
    w.runner.running.add("room-1");
    // That server's runner has no steer to offer.
    Object.defineProperty(w.runner, "steer", { value: undefined });
    await post(w.root, "room_a", "user:boss", "on an older server");
    await service.relayOnce();
    expect(w.runner.inputs.filter((i) => i.sessionId === "room-1")).toEqual([
      expect.objectContaining({ how: "started" }),
    ]);
  });

  it("stops two room sessions answering each other at the configured depth", async () => {
    await openA();
    w.config = { relayDepth: 2 };
    await post(w.root, "room_a", "user:boss", "go");
    await post(w.root, "room_a", "agent:acme_dev", "dev at 1");
    await post(w.root, "room_a", "agent:acme_web", "web at 2");
    await service.relayOnce();
    expect(w.runner.to("room-1")).toHaveLength(1); // the person's message
    expect(w.runner.to("room-2")).toHaveLength(2); // the person's and dev's
  });

  it("opens a room session for an employee invited in, and closes the one of an employee removed", async () => {
    const n = await openA();
    await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_web", "agent:acme_qa"]);
    await service.relayOnce();
    expect(w.gateway.opened.map((s) => s.agentId)).toEqual(["acme_dev", "acme_web", "acme_qa"]);
    const r = await service.get(P, O, n, BOSS);
    expect(r.openClones.map((c) => c.agentId)).toEqual(["acme_web", "acme_qa"]);
    expect(r.clones.find((c) => c.agentId === "acme_dev")?.closedAt).toBeDefined();
    // The first opener left: the moderator is the next one still in the room.
    expect(r.moderator).toBe("acme_web");
    await post(w.root, "room_a", "user:boss", "hello");
    await service.relayOnce();
    expect(w.runner.to("room-1")).toEqual([]);
    expect(w.runner.to("room-3")).toHaveLength(1);
  });

  it("opens a new room session when one was deleted, or refused an input", async () => {
    const n = await openA();
    w.sessions.deleted.add("room-1");
    await service.relayOnce();
    expect(w.gateway.opened.map((s) => s.sessionId)).toEqual(["room-1", "room-2", "room-3"]);
    w.runner.refuse.add("room-2");
    await post(w.root, "room_a", "user:boss", "anyone?");
    await service.relayOnce();
    await service.relayOnce();
    const r = await service.get(P, O, n, BOSS);
    expect(r.openClones.map((c) => c.sessionId)).toEqual(["room-3", "room-4"]);
  });

  it("relays nothing while the organization is paused, and nothing it said meanwhile afterwards", async () => {
    await openA();
    w.gateway.org = { ...w.gateway.org, status: "paused" };
    await post(w.root, "room_a", "user:boss", "while paused");
    await service.relayOnce();
    w.gateway.org = { ...w.gateway.org, status: "active" };
    await service.relayOnce();
    expect(w.runner.inputs).toEqual([]);
  });

  it("picks up where it left off after a restart, relaying nothing twice", async () => {
    await openA();
    await post(w.root, "room_a", "user:boss", "one");
    await service.relayOnce();
    const again = w.service();
    await post(w.root, "room_a", "user:boss", "two");
    await again.relayOnce();
    expect(w.runner.to("room-1").map((t) => t.split("\n").at(-1))).toEqual(["one", "two"]);
    expect(w.gateway.opened).toHaveLength(2);
  });
});

describe("the draft", () => {
  it("is kept by anyone while the room discusses: the moderator, another employee or a person", async () => {
    const n = await openA();
    const other = await service.draft(P, O, n, { record: "x" }, asAgent("acme_web"));
    expect(other.roadmap.record).toBe("x");
    const { roadmap } = await service.draft(
      P,
      O,
      n,
      { record: "We agree on a ledger.", body: BODY, items: ITEMS },
      asAgent("acme_dev"),
    );
    expect(roadmap.record).toBe("We agree on a ledger.");
    expect(roadmap.items.map((i) => i.key)).toEqual(["ledger", "page", "tests"]);
    expect((await service.draft(P, O, n, { record: "Revised." }, BOSS)).roadmap.items).toHaveLength(
      3,
    );
  });

  it("refuses items that are not well formed", async () => {
    const n = await openA();
    const bad = async (items: unknown) =>
      (await refusal(service.draft(P, O, n, { items }, BOSS))).status;
    expect(await bad([{ ...ITEMS[0], owner: "nobody" }])).toBe(400);
    expect(await bad([ITEMS[0], ITEMS[0]])).toBe(400);
    expect(await bad([{ ...ITEMS[0], cites: [] }])).toBe(400);
    expect(await bad([{ ...ITEMS[0], key: "Bad Key" }])).toBe(400);
    expect(await bad([{ ...ITEMS[0], stackedOn: "page" }, ITEMS[1]])).toBe(400);
    expect(await bad([{ ...ITEMS[2], employees: [] }])).toBe(400);
    expect(await bad([{ ...ITEMS[0], kind: "epic" }])).toBe(400);
  });

  it("creates nothing while the room discusses", async () => {
    const n = await openA();
    await service.draft(P, O, n, { body: BODY, items: ITEMS }, BOSS);
    expect((await service.list(P, O, BOSS)).roadmaps.map((r) => r.number)).toEqual([n]);
    expect(w.gateway.desks).toEqual([]);
  });
});

describe("establishing", () => {
  async function drafted(): Promise<number> {
    const n = await openA();
    await service.draft(
      P,
      O,
      n,
      { record: "Agreed.", body: BODY, items: ITEMS },
      asAgent("acme_dev"),
    );
    return n;
  }

  it("needs a body, items, and every cite naming a section of the body", async () => {
    const n = await openA();
    expect(await refusal(service.establish(P, O, n, BOSS))).toEqual({
      status: 400,
      code: "body_empty",
    });
    await service.draft(P, O, n, { body: BODY }, BOSS);
    expect(await refusal(service.establish(P, O, n, BOSS))).toEqual({
      status: 400,
      code: "items_empty",
    });
    await service.draft(P, O, n, { items: [{ ...ITEMS[0], cites: ["Nowhere"] }] }, BOSS);
    expect(await refusal(service.establish(P, O, n, BOSS))).toEqual({
      status: 400,
      code: "cite_unknown",
    });
    // Another employee than the moderator meets the same rules a person does.
    expect(await refusal(service.establish(P, O, n, asAgent("acme_web")))).toEqual({
      status: 400,
      code: "cite_unknown",
    });
  });

  it("establishes the roadmap — nothing archived — and leaves each proposal item a brief: nothing created, no owner told, the moderator asked for its approvals", async () => {
    const n = await drafted();
    const { roadmap, hints } = await service.establish(P, O, n, asAgent("acme_dev"));
    expect(hints).toEqual([]);
    expect(roadmap.status).toBe("established");
    expect(roadmap).not.toHaveProperty("archived");
    // No proposal owner hears of its item yet — only the derived roadmap's moderator is told.
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_qa"]);
    for (const d of w.gateway.desks) {
      expect(d.text).not.toContain("penguin org proposal create");
      expect(d.text).not.toContain("curl");
    }
    expect(roadmap.delegations.ledger).toMatchObject({
      owner: "acme_dev",
      stage: "brief",
      approvals: {},
      delivered: false,
    });
    expect(roadmap.delegations.page).toMatchObject({
      owner: "acme_web",
      base: "ledger",
      stage: "brief",
    });
    // The moderator's room session is asked, with the approve command; no create anywhere.
    const asked = w.runner.to("room-1");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('[ledger] "Roadmap ledger"');
    expect(asked[0]).toContain("/actions/roadmap.item.approve/runs");
    expect(asked[0]).toContain(`item:${n}/<key>`);
    expect(asked[0]).not.toContain("proposal create");
    expect(w.runner.to("room-2")).toEqual([]);
  });

  it("derives a roadmap item with its own room, discussing at once, and tells its moderator the room is open", async () => {
    const n = await drafted();
    const { roadmap, hints } = await service.establish(P, O, n, BOSS);
    expect(hints).toEqual([]);
    const child = roadmap.delegations.tests!.child!;
    expect(w.gateway.rooms.at(-1)).toMatchObject({
      channelId: `roadmap_${child}`,
      name: "Test plan",
      by: "user:boss",
      agentIds: ["acme_qa", "acme_dev"],
    });
    const derived = await service.get(P, O, child, BOSS);
    expect(derived).toMatchObject({
      status: "discussing",
      channelId: `roadmap_${child}`,
      moderator: "acme_qa",
    });
    expect(derived.openClones.map((c) => c.agentId)).toEqual(["acme_qa", "acme_dev"]);
    const told = w.gateway.desks.find((d) => d.agentId === "acme_qa")!.text;
    expect(told).toContain("Its room is open");
    expect(told).not.toContain("penguin org channel create");
  });

  it("derives a roadmap item as a roadmap waiting for its room when no room can be opened, and asks its moderator to open one", async () => {
    const n = await drafted();
    w.gateway.refuseRooms = "the organization is being moved";
    const { roadmap } = await service.establish(P, O, n, BOSS);
    const child = roadmap.delegations.tests?.child;
    expect(child).toBe(n + 1);
    const derived = await service.get(P, O, child!, BOSS);
    expect(derived).toMatchObject({
      status: "awaiting_room",
      parent: n,
      parentItem: "tests",
      name: "Test plan",
      employees: ["acme_qa", "acme_dev"],
    });
    const ask = w.gateway.desks.find((d) => d.agentId === "acme_qa")!.text;
    expect(ask).toContain(`[roadmap #${child} «Test plan»], which you moderate`);
    expect(ask).toContain("could not be opened yet");
    // A desk line carries no write command.
    expect(ask).not.toContain("penguin org channel");
    expect(ask).not.toContain("curl");
    // Its room bound, it discusses — and its employees' room sessions open.
    await writeChannel(w.root, "room_t", ["user:boss", "agent:acme_qa", "agent:acme_dev"]);
    const bound = await service.bindRoom(P, O, child!, "room_t", asAgent("acme_qa"));
    expect(bound.roadmap).toMatchObject({
      status: "discussing",
      channelId: "room_t",
      moderator: "acme_qa",
    });
  });

  it("stops relaying the room once established", async () => {
    const n = await drafted();
    await service.establish(P, O, n, BOSS);
    const before = w.runner.inputs.length;
    await post(w.root, "room_a", "user:boss", "after the fact");
    await service.relayOnce();
    expect(w.runner.inputs).toHaveLength(before);
    expect(w.runner.inputs.some((i) => i.text.includes("after the fact"))).toBe(false);
  });

  it("records a desk that cannot be told, and says so, without failing the establishment", async () => {
    const n = await drafted();
    w.gateway.refuse.set("acme_qa", "acme_qa is paused by its budget");
    const { roadmap, hints } = await service.establish(P, O, n, BOSS);
    expect(roadmap.status).toBe("established");
    expect(hints).toEqual(["acme_qa was not told: acme_qa is paused by its budget"]);
    expect(roadmap.delegations.tests).toMatchObject({ delivered: false });
    // The failed line is recorded on the roadmap it was about: the derived one.
    const derived = await service.get(P, O, roadmap.delegations.tests!.child!, BOSS);
    expect(derived.events.some((e) => e.kind === "notify_failed")).toBe(true);
  });
});

describe("an existing proposal taken in", () => {
  const OLD = { proposal: 107, title: "Old one", owner: "acme_web" };

  it("joins the draft as a proposal item while the room discusses — nothing created, nobody told", async () => {
    const n = await openA();
    const { roadmap } = await service.adopt(P, O, n, OLD, BOSS);
    expect(roadmap.items).toEqual([
      {
        key: "proposal-107",
        kind: "proposal",
        title: "Old one",
        brief: "Old one",
        owner: "acme_web",
        cites: [],
        stackedOn: null,
        proposal: 107,
      },
    ]);
    expect(roadmap.delegations).toEqual({});
    expect(roadmap.events.at(-1)).toMatchObject({
      kind: "adopted",
      note: "proposal-107 ← proposal #107",
    });
    expect(w.gateway.desks).toEqual([]);
    expect(w.runner.inputs).toEqual([]);
    // The moderator keeps it in the items it writes, and it needs no cite.
    const kept = await service.draft(
      P,
      O,
      n,
      { body: BODY, items: [...roadmap.items, ITEMS[0]] },
      asAgent("acme_dev"),
    );
    expect(kept.roadmap.items.map((i) => i.key)).toEqual(["proposal-107", "ledger"]);
    expect(kept.roadmap.items[0]).toMatchObject({ proposal: 107, cites: [] });
  });

  it("is delegated and linked at the establishment with no brief and no approvals, while a written item still waits for them", async () => {
    const n = await openA();
    await service.adopt(P, O, n, OLD, BOSS);
    const items = [...(await service.get(P, O, n, BOSS)).items, ITEMS[0]];
    await service.draft(P, O, n, { body: BODY, items }, BOSS);
    const { roadmap } = await service.establish(P, O, n, BOSS);
    expect(roadmap.delegations["proposal-107"]).toMatchObject({
      stage: "delegated",
      owner: "acme_web",
      proposal: 107,
      approvals: {},
    });
    expect(roadmap.delegations.ledger).toMatchObject({ stage: "brief" });
    // The owner already has its proposal: no desk line for it (nor for the brief).
    expect(w.gateway.desks).toEqual([]);
    // The moderator is asked to approve the written item only.
    const asked = w.runner.to("room-1").join("\n");
    expect(asked).toContain("ledger");
    expect(asked).not.toContain("proposal-107");
    // Approving it is not a thing: it has no brief to approve.
    expect(await refusal(service.approve(P, O, n, "proposal-107", BOSS))).toEqual({
      status: 409,
      code: "already_approved",
    });
    // Established again after a reopening, it is left as it stands.
    await service.reopen(P, O, n, "One more look.", BOSS);
    const again = await service.establish(P, O, n, BOSS);
    expect(
      again.roadmap.events.filter((e) => e.kind === "linked" && e.note?.includes("#107")),
    ).toHaveLength(1);
  });

  it("is delegated and linked at once on an established roadmap", async () => {
    const n = await openA();
    await service.draft(P, O, n, { body: BODY, items: [ITEMS[0]] }, BOSS);
    await service.establish(P, O, n, BOSS);
    w.gateway.desks = [];
    const { roadmap } = await service.adopt(
      P,
      O,
      n,
      { ...OLD, brief: "Keeps the history." },
      asAgent("acme_dev"),
    );
    expect(roadmap.items.map((i) => i.key)).toEqual(["ledger", "proposal-107"]);
    expect(roadmap.delegations["proposal-107"]).toMatchObject({
      stage: "delegated",
      brief: "Keeps the history.",
      proposal: 107,
    });
    expect(w.gateway.desks).toEqual([]);
  });

  it("is anyone's act, once per proposal, on a roadmap being discussed or established", async () => {
    const n = await openA();
    expect((await refusal(service.adopt(P, O, n, { ...OLD, proposal: 0 }, BOSS))).status).toBe(400);
    expect((await refusal(service.adopt(P, O, n, { ...OLD, title: "" }, BOSS))).status).toBe(400);
    expect((await refusal(service.adopt(P, O, n, { ...OLD, owner: "nobody" }, BOSS))).status).toBe(
      400,
    );
    // Another employee than the moderator takes it in as a person would.
    await service.adopt(P, O, n, OLD, asAgent("acme_web"));
    expect(await refusal(service.adopt(P, O, n, OLD, BOSS))).toEqual({
      status: 409,
      code: "already_adopted",
    });
    // The same proposal twice in written items is refused as well.
    const twice = [
      { ...ITEMS[0], proposal: 61 },
      { ...ITEMS[1], proposal: 61 },
    ];
    expect((await refusal(service.draft(P, O, n, { items: twice }, BOSS))).status).toBe(400);
  });
});

describe("the approvals", () => {
  async function established(): Promise<number> {
    const n = await openA();
    await service.draft(P, O, n, { body: BODY, items: ITEMS }, BOSS);
    await service.establish(P, O, n, BOSS);
    w.gateway.desks = [];
    return n;
  }

  it("needs the moderator and another member: one alone creates nothing, the second creates the proposal, links it and tells the owner its number", async () => {
    const n = await established();
    const first = await service.approve(P, O, n, "ledger", BOSS);
    expect(first.roadmap.delegations.ledger).toMatchObject({
      stage: "brief",
      approvals: { member: { by: "user:boss" } },
    });
    expect(w.proposals.created).toEqual([]);
    expect(w.gateway.desks).toEqual([]);
    const lines = (await eventsOf(w.root)).length;
    const both = await service.approve(P, O, n, "ledger", asAgent("acme_dev"));
    // Created through company-proposals: the owner the author, the item's title and brief.
    expect(w.proposals.created).toEqual([
      {
        projectId: P,
        orgId: O,
        author: "acme_dev",
        title: "Roadmap ledger",
        brief: "An append-only ledger.",
        delegatedBy: "agent:acme_dev",
        roadmap: { number: n, key: "ledger" },
      },
    ]);
    expect(both.roadmap.delegations.ledger).toMatchObject({
      stage: "delegated",
      proposal: 200,
      delivered: true,
      approvals: { member: { by: "user:boss" }, moderator: { by: "agent:acme_dev" } },
    });
    expect((await eventsOf(w.root)).slice(lines).map((l) => l.kind)).toEqual([
      "approved",
      "delegated",
      "linked",
    ]);
    expect((await eventsOf(w.root)).at(-1)).toMatchObject({
      kind: "linked",
      number: n,
      note: "ledger → proposal #200",
      by: "agent:acme_dev",
    });
    // The owner is told once, with the number; the one stacked on it learns the number too.
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_dev", "acme_web"]);
    const told = w.gateway.desks[0]!.text;
    expect(told).toContain(
      'Your item [ledger] "Roadmap ledger" is approved: by user:boss as member',
    );
    expect(told).toContain("and by agent:acme_dev as moderator");
    expect(told).toContain("An append-only ledger.");
    expect(told).toContain("not stacked on another proposal");
    expect(told).toContain("proposal #200");
    expect(told).not.toContain("may be created now");
    expect(told).not.toContain("penguin org proposal create");
    expect(told).not.toContain("curl");
    expect(w.gateway.desks[1]!.text).toContain("is proposal #200 now");
    // The other items are still briefs.
    expect(both.roadmap.delegations.page).toMatchObject({ stage: "brief", approvals: {} });
  });

  it("records no approval when the proposal cannot be created: the item stays a brief and the approval can be given again", async () => {
    const n = await established();
    await service.approve(P, O, n, "ledger", asAgent("acme_dev"));
    const lines = (await eventsOf(w.root)).length;
    w.proposals.refuse = "author must be an employee of acme: acme_dev";
    expect(await refusal(service.approve(P, O, n, "ledger", BOSS))).toEqual({
      status: 409,
      code: "proposal_not_created",
    });
    expect(await eventsOf(w.root)).toHaveLength(lines);
    expect(w.gateway.desks).toEqual([]);
    const again = await service.approve(P, O, n, "ledger", BOSS);
    expect(again.roadmap.delegations.ledger).toMatchObject({ stage: "delegated", proposal: 200 });
    // The creation is recorded in the person's name when the person's approval completes it.
    expect(w.proposals.created.map((c) => c.delegatedBy)).toEqual(["user:boss"]);
  });

  it("is given once per role, once per principal, to an established roadmap's proposal items", async () => {
    const discussing = await openA();
    expect(await refusal(service.approve(P, O, discussing, "ledger", BOSS))).toEqual({
      status: 409,
      code: "not_established",
    });
    const n = await established();
    expect(await refusal(service.approve(P, O, n, "tests", BOSS))).toEqual({
      status: 404,
      code: "item_not_found",
    });
    // An employee other than the moderator approves as a member, as a person would.
    const member = await service.approve(P, O, n, "ledger", asAgent("acme_web"));
    expect(member.roadmap.delegations.ledger?.approvals).toMatchObject({
      member: { by: "agent:acme_web" },
    });
    // The member role is filled: nobody else fills it again.
    expect(await refusal(service.approve(P, O, n, "ledger", BOSS))).toEqual({
      status: 409,
      code: "already_approved",
    });
    // The same principal cannot fill a second role.
    expect(await refusal(service.approve(P, O, n, "ledger", asAgent("acme_web")))).toEqual({
      status: 409,
      code: "already_approved",
    });
    await service.approve(P, O, n, "ledger", asAgent("acme_dev"));
    expect(await refusal(service.approve(P, O, n, "ledger", asAgent("acme_dev")))).toEqual({
      status: 409,
      code: "already_approved",
    });
  });

  it("follows the roles the guard's verdict carries: a person's role refuses an employee member and takes a person", async () => {
    const n = await established();
    const subject = { kind: "item", id: `${n}/ledger`, text: `item:${n}/ledger` };
    // The guard a company workflow's replacement makes: the default, handed other roles.
    const guard = withApprovalRoles(["moderator", "person"])(
      roadmapGuards["roadmap.item.approve"]!,
    );
    const act = (principal: string, agentId: string | null): WriteAct => ({
      check: (state, opts) =>
        guard({
          caller: { principal, agentId, userId: "" },
          subject,
          state,
          params: opts?.params ?? {},
          running: 0,
        }),
    });
    expect(
      await refusal(
        service.approve(P, O, n, "ledger", asAgent("acme_web"), act("agent:acme_web", "acme_web")),
      ),
    ).toEqual({ status: 403, code: "not_approver" });
    const person = await service.approve(P, O, n, "ledger", BOSS, act("user:boss", null));
    expect(person.roadmap.delegations.ledger?.approvals).toMatchObject({
      person: { by: "user:boss" },
    });
    const both = await service.approve(
      P,
      O,
      n,
      "ledger",
      asAgent("acme_dev"),
      act("agent:acme_dev", "acme_dev"),
    );
    expect(both.roadmap.delegations.ledger).toMatchObject({ stage: "delegated", proposal: 200 });
  });

  it("takes a brief that is a proposal which exists already by its link — from anyone but its owner — with no approvals and no start", async () => {
    const n = await established();
    // The moderator is told how: an existing proposal is linked, not approved.
    expect(w.runner.to("room-1").join("\n")).toContain("/actions/roadmap.item.link/runs");
    // From its owner's desk a brief still waits for both approvals.
    expect(await refusal(service.link(P, O, n, "page", 61, asAgent("acme_web")))).toEqual({
      status: 409,
      code: "not_approved",
    });
    // The moderator (acme_dev) does not own [page]: its link says what the item is.
    const { roadmap } = await service.link(P, O, n, "page", 61, asAgent("acme_dev"));
    expect(roadmap.delegations.page).toMatchObject({
      stage: "delegated",
      proposal: 61,
      delivered: false,
      approvals: {},
    });
    // Nothing to start: nothing is created, its owner is told nothing, and there is nothing left to approve.
    expect(w.proposals.created).toEqual([]);
    expect(w.gateway.desks).toEqual([]);
    expect(await refusal(service.approve(P, O, n, "page", BOSS))).toEqual({
      status: 409,
      code: "already_approved",
    });
    // A person links the moderator's own item; the owner stacked on it learns the number.
    const person = await service.link(P, O, n, "ledger", 60, BOSS);
    expect(person.roadmap.delegations.ledger).toMatchObject({ stage: "delegated", proposal: 60 });
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_web"]);
    // Linked once, delegated once: an establishment after a reopening leaves both as they stand.
    await service.reopen(P, O, n, "One more look.", BOSS);
    const again = await service.establish(P, O, n, BOSS);
    expect(again.roadmap.delegations.page).toMatchObject({ stage: "delegated", proposal: 61 });
    expect(again.roadmap.delegations.ledger).toMatchObject({ stage: "delegated", proposal: 60 });
  });

  it("is linked by its owner only after its approvals, which have linked it already, and tells the owner stacked on it the number", async () => {
    const n = await established();
    expect(await refusal(service.link(P, O, n, "ledger", 60, asAgent("acme_dev")))).toEqual({
      status: 409,
      code: "not_approved",
    });
    await service.approve(P, O, n, "ledger", BOSS);
    await service.approve(P, O, n, "ledger", asAgent("acme_dev"));
    expect(w.gateway.desks).toContainEqual({
      agentId: "acme_web",
      text: `[roadmap #${n} «Queue migration»] "Roadmap ledger", which your item [page] "Side panel" is stacked on, is proposal #200 now: base your branch on that one's.`,
    });
    w.gateway.desks = [];
    // Delegated, the item is linked again by anyone: another employee relinks it.
    const relinked = await service.link(P, O, n, "ledger", 60, asAgent("acme_web"));
    expect(relinked.roadmap.delegations.ledger).toMatchObject({ proposal: 60 });
    expect((await refusal(service.link(P, O, n, "tests", 61, BOSS))).status).toBe(404);
  });

  it("is reopened by anyone who finds it lacking: the room discusses again and its sessions are told why", async () => {
    const n = await established();
    await post(w.root, "room_a", "user:boss", "said while established");
    const { roadmap } = await service.reopen(
      P,
      O,
      n,
      "The ledger needs a migration first.",
      asAgent("acme_web"),
    );
    expect(roadmap.status).toBe("discussing");
    for (const s of ["room-1", "room-2"]) {
      expect(w.runner.to(s).at(-1)).toContain(
        "reopened by agent:acme_web: The ledger needs a migration first.",
      );
    }
    await post(w.root, "room_a", "user:boss", "after the reopening");
    await service.relayOnce();
    expect(w.runner.to("room-1").at(-1)).toContain("after the reopening");
    expect(w.runner.inputs.some((i) => i.text.includes("said while established"))).toBe(false);
    // Only the status gates a reopening: anyone reopens, but not a roadmap already discussing.
    expect(await refusal(service.reopen(P, O, n, "x", asAgent("acme_ceo")))).toEqual({
      status: 409,
      code: "not_established",
    });
  });

  it("starts a changed brief again at the next establishment — its approvals gone — and leaves the rest as they stood", async () => {
    const n = await established();
    await service.approve(P, O, n, "ledger", BOSS);
    await service.approve(P, O, n, "ledger", asAgent("acme_dev"));
    await service.approve(P, O, n, "page", BOSS);
    await service.reopen(P, O, n, "Split the page.", BOSS);
    const items = [
      ITEMS[0],
      { ...ITEMS[1], brief: "The draft beside the room, read-only." },
      ITEMS[2],
    ];
    await service.draft(P, O, n, { items }, BOSS);
    w.gateway.desks = [];
    const { roadmap } = await service.establish(P, O, n, BOSS);
    expect(w.gateway.desks).toEqual([]);
    expect(roadmap.delegations.ledger).toMatchObject({ stage: "delegated" });
    expect(roadmap.delegations.page).toMatchObject({
      stage: "brief",
      brief: "The draft beside the room, read-only.",
      approvals: {},
    });
  });
});

describe("the room a roadmap opens itself", () => {
  it("opens an unlisted room — the person and the employees in it — and discusses in it at once", async () => {
    const { roadmap } = await service.create(
      P,
      O,
      { name: "Queue migration", employees: ["acme_dev", "acme_web"], brief: "Move the queue" },
      BOSS,
    );
    expect(w.gateway.rooms).toEqual([
      {
        projectId: P,
        orgId: O,
        channelId: `roadmap_${roadmap.number}`,
        name: "Queue migration",
        purpose: `Roadmap #${roadmap.number} — Move the queue`,
        by: "user:boss",
        agentIds: ["acme_dev", "acme_web"],
      },
    ]);
    expect(roadmap).toMatchObject({ channelId: `roadmap_${roadmap.number}`, status: "discussing" });
    expect(roadmap.openClones.map((c) => c.agentId)).toEqual(["acme_dev", "acme_web"]);
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_dev", "acme_web"]);
    // The room is borrowed like any channel: a message there reaches the room sessions, and
    // no desk hears of it.
    await post(w.root, `roadmap_${roadmap.number}`, "user:boss", "What goes first?");
    await service.relayOnce();
    expect(w.runner.to("room-1")).toHaveLength(1);
    expect(w.gateway.desks).toHaveLength(2);
  });

  it("takes the next id when roadmap_<n> is taken", async () => {
    await writeChannel(w.root, "roadmap_1", ["user:boss"]);
    const { roadmap } = await service.create(P, O, { name: "Q", employees: ["acme_dev"] }, BOSS);
    expect(roadmap.channelId).toBe("roadmap_1_2");
  });

  it("opens no roadmap when its room cannot be opened, and says why", async () => {
    w.gateway.refuseRooms = "disk full";
    expect(
      await refusal(service.create(P, O, { name: "Q", employees: ["acme_dev"] }, BOSS)),
    ).toEqual({ status: 500, code: "room_failed" });
    expect((await service.list(P, O, BOSS)).roadmaps).toEqual([]);
  });
});

describe("names, and no shelf", () => {
  it("renames; a roadmap has no archive of its own — archiving its room's channel is what stops the relay", async () => {
    const n = await openA();
    expect((await service.rename(P, O, n, "Queue, again", BOSS)).roadmap.name).toBe("Queue, again");
    expect("setArchived" in service).toBe(false);
    await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"], {
      archived: true,
    });
    await post(w.root, "room_a", "user:boss", "said in an archived channel");
    await service.relayOnce();
    expect(w.runner.inputs).toEqual([]);
    const r = await service.get(P, O, n, BOSS);
    expect(r.status).toBe("discussing");
    expect(r).not.toHaveProperty("archived");
  });

  it("lists a room's roadmaps", async () => {
    const n = await openA();
    await writeChannel(w.root, "room_b", ["agent:acme_qa"]);
    await service.create(
      P,
      O,
      { name: "Other", channelId: "room_b", employees: ["acme_qa"] },
      BOSS,
    );
    const { roadmaps } = await service.list(P, O, BOSS, { channel: "room_a" });
    expect(roadmaps.map((r) => r.number)).toEqual([n]);
  });
});
