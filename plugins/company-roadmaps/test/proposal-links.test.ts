/**
 * The proposal links company-proposals asks for (proposals.ts, proposalRoadmapLinks): one row
 * per item whose delegation carries a proposal — adopted at the establishment, or created by
 * the item's second approval — and nothing for an item still waiting as a brief or a draft
 * that was never established.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { proposalRoadmapLinks, type RoadmapService } from "../src/index.js";
import { BOSS, ORG, PROJECT, asAgent, world, writeChannel, type World } from "./fakes.js";

const BODY = "## The ledger\nOne file per organization.\n";
const LEDGER = {
  key: "ledger",
  kind: "proposal",
  title: "Roadmap ledger",
  brief: "An append-only ledger.",
  owner: "acme_dev",
  cites: ["The ledger"],
};
const OPEN = { name: "Queue", channelId: "room_a", employees: ["acme_dev", "acme_web"] };

let w: World;
let service: RoadmapService;

beforeEach(async () => {
  w = await world();
  service = w.service();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
});

describe("the roadmaps each proposal belongs to", () => {
  it("lists the adopted and the created proposals once their delegations name them", async () => {
    const links = proposalRoadmapLinks(service);
    const n = (await service.create(PROJECT, ORG, OPEN, BOSS)).roadmap.number;
    const { roadmap } = await service.adopt(
      PROJECT,
      ORG,
      n,
      { proposal: 107, title: "Old one", owner: "acme_web" },
      BOSS,
    );
    await service.draft(PROJECT, ORG, n, { body: BODY, items: [...roadmap.items, LEDGER] }, BOSS);
    // A draft links nothing yet: only an establishment's delegations do.
    expect(await links(PROJECT, ORG, BOSS)).toEqual([]);

    await service.establish(PROJECT, ORG, n, BOSS);
    expect(await links(PROJECT, ORG, BOSS)).toEqual([
      { proposal: 107, number: n, name: "Queue", itemKey: "proposal-107" },
    ]);

    await service.approve(PROJECT, ORG, n, "ledger", BOSS);
    await service.approve(PROJECT, ORG, n, "ledger", asAgent("acme_dev"));
    const created = w.proposals.created.at(-1);
    expect(created?.roadmap).toEqual({ number: n, key: "ledger" });
    expect(await links(PROJECT, ORG, asAgent("acme_web"))).toEqual([
      { proposal: 107, number: n, name: "Queue", itemKey: "proposal-107" },
      { proposal: 200, number: n, name: "Queue", itemKey: "ledger" },
    ]);
  });
});
