/**
 * The service over the gateway, session-runtime and session-index fakes and a real directory:
 * a person opens a roadmap over a room; every employee in it gets a room session (its desk
 * cloned for the room) and the room's messages reach those sessions — never a desk; the
 * moderator drafts; establishing archives it and delegates every item (stacked proposals to
 * their owners' desks, a derived roadmap waiting for its room); an owner links its proposal
 * and the one stacked on it learns the number; an owner reopens it. Nothing here starts a
 * server or a Session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoadmapError, type RoadmapService } from "../src/index.js";
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

async function openA(): Promise<number> {
  const { roadmap } = await service.create(
    P,
    O,
    {
      name: "Queue migration",
      channelId: "room_a",
      employees: ["acme_dev", "acme_web"],
      brief: "Move the queue",
    },
    BOSS,
  );
  return roadmap.number;
}

describe("opening a roadmap", () => {
  it("clones the desk of every employee in the room — a session each, the first moderating — and puts nothing on a desk", async () => {
    const n = await openA();
    expect(w.gateway.opened.map((s) => s.agentId)).toEqual(["acme_dev", "acme_web"]);
    expect(w.gateway.desks).toEqual([]);
    const [dev, web] = w.gateway.opened;
    expect(dev?.title).toBe(`Queue migration · roadmap #${n}`);
    expect(dev?.body).toContain("Moderator: acme_dev (you)");
    expect(dev?.body).toContain("penguin org channel send --org-id acme --channel room_a");
    expect(dev?.body).toContain("/draft");
    expect(web?.body).toContain("Moderator: acme_dev.");
    expect(web?.body).not.toContain("/establish");
    const r = await service.get(P, O, n, BOSS);
    expect(r).toMatchObject({ status: "discussing", moderator: "acme_dev" });
    expect(r.openClones).toEqual([
      { agentId: "acme_dev", sessionId: "room-1" },
      { agentId: "acme_web", sessionId: "room-2" },
    ]);
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

  it("is a person's act: an employee is refused, as is a room without the employees, or no room", async () => {
    expect(
      await refusal(
        service.create(
          P,
          O,
          { name: "x", channelId: "room_a", employees: ["acme_dev"] },
          asAgent("acme_dev"),
        ),
      ),
    ).toEqual({ status: 403, code: "people_only" });
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
  it("is kept by the moderator or a person; another employee is refused", async () => {
    const n = await openA();
    expect(await refusal(service.draft(P, O, n, { record: "x" }, asAgent("acme_web")))).toEqual({
      status: 403,
      code: "not_moderator",
    });
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
    expect(await refusal(service.establish(P, O, n, asAgent("acme_web")))).toMatchObject({
      status: 403,
    });
  });

  it("archives the roadmap and delegates at once: each proposal to its owner's desk, stacked on the previous one", async () => {
    const n = await drafted();
    const { roadmap, hints } = await service.establish(P, O, n, asAgent("acme_dev"));
    expect(hints).toEqual([]);
    expect(roadmap).toMatchObject({ status: "established", archived: true });
    const lines = w.gateway.desks.filter((d) => d.text.includes(`[roadmap #${n} `));
    const toDev = lines.find((d) => d.agentId === "acme_dev")!.text;
    const toWeb = lines.find((d) => d.agentId === "acme_web")!.text;
    expect(toDev).toContain("[ledger]");
    expect(toDev).toContain("An append-only ledger.");
    expect(toDev).toContain("not stacked on another proposal");
    expect(toDev).toContain("penguin org proposal create --org-id acme --author acme_dev");
    expect(toWeb).toContain('stacked on "Roadmap ledger", which has no proposal number yet');
    expect(roadmap.delegations.page).toMatchObject({
      owner: "acme_web",
      base: "ledger",
      delivered: true,
    });
  });

  it("derives a roadmap item as a roadmap waiting for its room, and asks its moderator to open one", async () => {
    const n = await drafted();
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
    expect(ask).toContain(
      "penguin org channel invite --org-id acme <channel_id> agent:acme_qa agent:acme_dev",
    );
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
    await post(w.root, "room_a", "user:boss", "after the fact");
    await service.relayOnce();
    expect(w.runner.inputs).toEqual([]);
  });

  it("records a desk that cannot be told, and says so, without failing the establishment", async () => {
    const n = await drafted();
    w.gateway.refuse.set("acme_web", "acme_web is paused by its budget");
    const { roadmap, hints } = await service.establish(P, O, n, BOSS);
    expect(roadmap.status).toBe("established");
    expect(hints).toEqual(["acme_web was not told: acme_web is paused by its budget"]);
    expect(roadmap.delegations.page).toMatchObject({ delivered: false });
    expect(roadmap.events.some((e) => e.kind === "notify_failed")).toBe(true);
  });
});

describe("after the establishment", () => {
  async function established(): Promise<number> {
    const n = await openA();
    await service.draft(P, O, n, { body: BODY, items: ITEMS }, BOSS);
    await service.establish(P, O, n, BOSS);
    w.gateway.desks = [];
    return n;
  }

  it("links the owner's proposal, and tells the owner stacked on it the number", async () => {
    const n = await established();
    expect(await refusal(service.link(P, O, n, "ledger", 60, asAgent("acme_web")))).toEqual({
      status: 403,
      code: "not_owner",
    });
    const { roadmap } = await service.link(P, O, n, "ledger", 60, asAgent("acme_dev"));
    expect(roadmap.delegations.ledger?.proposal).toBe(60);
    expect(w.gateway.desks).toEqual([
      {
        agentId: "acme_web",
        text: `[roadmap #${n} «Queue migration»] "Roadmap ledger", which your item [page] "Side panel" is stacked on, is proposal #60 now: base your branch on that one's.`,
      },
    ]);
    expect((await refusal(service.link(P, O, n, "tests", 61, BOSS))).status).toBe(404);
  });

  it("is reopened by an owner who finds it lacking: the room discusses again and its sessions are told why", async () => {
    const n = await established();
    await post(w.root, "room_a", "user:boss", "said while established");
    expect(await refusal(service.reopen(P, O, n, "x", asAgent("acme_ceo")))).toMatchObject({
      status: 403,
    });
    const { roadmap } = await service.reopen(
      P,
      O,
      n,
      "The ledger needs a migration first.",
      asAgent("acme_web"),
    );
    expect(roadmap).toMatchObject({ status: "discussing", archived: false });
    for (const s of ["room-1", "room-2"]) {
      expect(w.runner.to(s)).toHaveLength(1);
      expect(w.runner.to(s)[0]).toContain(
        "reopened by agent:acme_web: The ledger needs a migration first.",
      );
    }
    await post(w.root, "room_a", "user:boss", "after the reopening");
    await service.relayOnce();
    expect(w.runner.to("room-1").at(-1)).toContain("after the reopening");
    expect(w.runner.inputs.some((i) => i.text.includes("said while established"))).toBe(false);
  });

  it("delegates again at the next establishment only what changed", async () => {
    const n = await established();
    await service.reopen(P, O, n, "Split the page.", BOSS);
    const items = [
      ITEMS[0],
      { ...ITEMS[1], brief: "The draft beside the room, read-only." },
      ITEMS[2],
    ];
    await service.draft(P, O, n, { items }, BOSS);
    await service.establish(P, O, n, BOSS);
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_web"]);
    expect(w.gateway.desks[0]?.text).toContain("The brief of your item changed");
  });
});

describe("the channel claim", () => {
  const room = (channelId: string) => ({ projectId: P, orgId: O, channelId });

  it("claims the room of a roadmap under discussion, and handles the message at once — no poll, no desk", async () => {
    await openA();
    await post(w.root, "room_a", "user:boss", "@acme_dev what goes first?", {
      mentions: ["agent:acme_dev"],
    });
    expect(service.claims(room("room_a"))).toBe(true);
    await vi.waitFor(() => expect(w.runner.to("room-1")).toHaveLength(1));
    expect(w.runner.to("room-1")[0]).toContain("what goes first?");
    expect(w.runner.to("room-2")).toHaveLength(1);
    expect(w.gateway.desks).toEqual([]);
  });

  it("does not claim a channel that is no roadmap's room, an established one, a shelved one, or any while company mode is off", async () => {
    const n = await openA();
    expect(service.claims(room("room_b"))).toBe(false);
    w.gateway.enabled = false;
    expect(service.claims(room("room_a"))).toBe(false);
    w.gateway.enabled = true;
    await service.setArchived(P, O, n, true, BOSS);
    expect(service.claims(room("room_a"))).toBe(false);
    await service.setArchived(P, O, n, false, BOSS);
    expect(service.claims(room("room_a"))).toBe(true);
    await service.draft(P, O, n, { body: BODY, items: [ITEMS[0]] }, BOSS);
    await service.establish(P, O, n, BOSS);
    expect(service.claims(room("room_a"))).toBe(false);
  });

  it("answers after a restart once the ledgers on disk are loaded", async () => {
    await openA();
    const again = w.service();
    expect(again.claims(room("room_a"))).toBe(false);
    await again.preload();
    expect(again.claims(room("room_a"))).toBe(true);
  });
});

describe("names and the shelf", () => {
  it("renames; shelves a discussion (the relay stops) and takes it back; an established one is reopened instead", async () => {
    const n = await openA();
    expect((await service.rename(P, O, n, "Queue, again", BOSS)).roadmap.name).toBe("Queue, again");
    await service.setArchived(P, O, n, true, asAgent("acme_dev"));
    await post(w.root, "room_a", "user:boss", "shelved");
    await service.relayOnce();
    expect(w.runner.inputs).toEqual([]);
    expect(await refusal(service.draft(P, O, n, { record: "x" }, BOSS))).toMatchObject({
      status: 409,
    });
    await service.setArchived(P, O, n, false, BOSS);
    await service.draft(P, O, n, { body: BODY, items: [ITEMS[0]] }, BOSS);
    await service.establish(P, O, n, BOSS);
    expect(await refusal(service.setArchived(P, O, n, false, BOSS))).toEqual({
      status: 409,
      code: "established",
    });
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
