/**
 * An item linked to its proposal whose brief changed at a later establishment: it is a brief
 * again, still linked, and its second approval creates nothing while that proposal is open —
 * company-proposals rewrites the proposal's brief, the link stays and the owner is told so. Only
 * a merged or rejected proposal gets a new one, linked in its place, as for an item with none.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteRoadmapStore, companyDbPath, type RoadmapService } from "../src/index.js";
import { BOSS, ORG, PROJECT, asAgent, world, writeChannel, type World } from "./fakes.js";

const P = PROJECT;
const O = ORG;

const BODY = `# Queue migration

## The ledger
One file per organization.

## The page
A side panel.
`;

const LEDGER = {
  key: "ledger",
  kind: "proposal",
  title: "Roadmap ledger",
  brief: "An append-only ledger.",
  owner: "acme_dev",
  cites: ["The ledger"],
};
const PAGE = {
  key: "page",
  kind: "proposal",
  title: "Side panel",
  brief: "The draft beside the room.",
  owner: "acme_web",
  cites: ["The page"],
};
const CHANGED = "An append-only ledger, one per organization.";

let w: World;
let service: RoadmapService;

beforeEach(async () => {
  w = await world();
  service = w.service();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
});

/** The roadmap events written so far, in order, read from the store on disk. */
function eventKinds(): string[] {
  const store = SqliteRoadmapStore.open(companyDbPath(w.root, P, O));
  try {
    return store
      .list()
      .flatMap((r) => r.events)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => e.kind);
  } finally {
    store.close();
  }
}

/**
 * Roadmap A established with [ledger] approved (proposal #200) and [page] stacked on it, then
 * reopened and established again with [ledger]'s brief changed: a brief again, still linked.
 */
async function rebriefed(): Promise<number> {
  const { roadmap } = await service.create(
    P,
    O,
    { name: "Queue migration", channelId: "room_a", employees: ["acme_dev", "acme_web"] },
    BOSS,
  );
  const n = roadmap.number;
  await service.draft(P, O, n, { body: BODY, items: [LEDGER, PAGE] }, BOSS);
  await service.establish(P, O, n, BOSS);
  await service.approve(P, O, n, "ledger", BOSS);
  await service.approve(P, O, n, "ledger", asAgent("acme_dev"));
  await service.reopen(P, O, n, "The ledger is per organization.", BOSS);
  await service.draft(P, O, n, { items: [{ ...LEDGER, brief: CHANGED }, PAGE] }, BOSS);
  const again = await service.establish(P, O, n, BOSS);
  // The view still names the proposal while the changed brief waits for its approvals.
  expect(again.roadmap.delegations.ledger).toMatchObject({
    stage: "brief",
    brief: CHANGED,
    proposal: 200,
    approvals: {},
  });
  await service.approve(P, O, n, "ledger", BOSS);
  w.gateway.desks = [];
  return n;
}

describe("a linked item approved again with a changed brief", () => {
  it("rewrites its open proposal's brief instead of creating a second one, keeps the link and tells the owner", async () => {
    const n = await rebriefed();
    const before = eventKinds().length;
    const { roadmap } = await service.approve(P, O, n, "ledger", asAgent("acme_dev"));

    expect(w.proposals.created).toHaveLength(1);
    expect(w.proposals.rebriefed).toEqual([
      {
        number: 200,
        owner: "acme_dev",
        brief: CHANGED,
        delegatedBy: "agent:acme_dev",
        roadmap: { number: n, key: "ledger" },
      },
    ]);
    expect(roadmap.delegations.ledger).toMatchObject({
      stage: "delegated",
      proposal: 200,
      delivered: true,
      approvals: { person: { by: "user:boss" }, moderator: { by: "agent:acme_dev" } },
    });
    // The approval and the delegation are recorded; the link stands as it was.
    expect(eventKinds().slice(before)).toEqual(["approved", "delegated"]);
    // The owner is told of the rewrite; the owner stacked on it knows the number already.
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_dev"]);
    const told = w.gateway.desks[0]!.text;
    expect(told).toContain(CHANGED);
    expect(told).toContain("No new proposal is created: proposal #200");
    expect(told).not.toContain("is created for you");
  });

  it("creates a new proposal and links it in place of one merged or rejected", async () => {
    const n = await rebriefed();
    w.proposals.closed.add(200);
    const before = eventKinds().length;
    const { roadmap } = await service.approve(P, O, n, "ledger", asAgent("acme_dev"));

    expect(w.proposals.rebriefed).toEqual([]);
    expect(w.proposals.created.map((c) => c.brief)).toEqual(["An append-only ledger.", CHANGED]);
    expect(roadmap.delegations.ledger).toMatchObject({ stage: "delegated", proposal: 201 });
    expect(eventKinds().slice(before)).toEqual(["approved", "delegated", "linked"]);
    expect(w.gateway.desks.map((d) => d.agentId)).toEqual(["acme_dev", "acme_web"]);
    expect(w.gateway.desks[0]!.text).toContain("Its proposal is created for you: proposal #201");
    expect(w.gateway.desks[1]!.text).toContain("is proposal #201 now");
  });
});
