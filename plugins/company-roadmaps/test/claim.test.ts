/**
 * The channel claim: which channels the plugin takes over from the organization's mention
 * delivery (the room of a roadmap under discussion, answered from the ledger on disk at every
 * question), and that a claimed message is handled at once — relayed to the room sessions,
 * no desk told.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roomClaim, type RoadmapService } from "../src/index.js";
import { BOSS, ORG, PROJECT, post, world, writeChannel, type World } from "./fakes.js";

const room = (channelId: string) => ({ projectId: PROJECT, orgId: ORG, channelId });

let w: World;
let service: RoadmapService;

beforeEach(async () => {
  w = await world();
  service = w.service();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
});

async function openA(): Promise<number> {
  const { roadmap } = await service.create(
    PROJECT,
    ORG,
    { name: "Queue migration", channelId: "room_a", employees: ["acme_dev", "acme_web"] },
    BOSS,
  );
  return roadmap.number;
}

describe("the channel claim", () => {
  it("claims the room of a roadmap under discussion and hands it over at once: the room sessions get the message, no desk does", async () => {
    const n = await openA();
    const handed: number[] = [];
    const claim = roomClaim(w.root, (channel, number) => {
      handed.push(number);
      void service.relayRoadmap(channel.projectId, channel.orgId, number);
    });
    await post(w.root, "room_a", "user:boss", "@acme_dev what goes first?", {
      mentions: ["agent:acme_dev"],
    });
    expect(claim(room("room_a"))).toBe(true);
    expect(handed).toEqual([n]);
    await vi.waitFor(() => expect(w.runner.to("room-1")).toHaveLength(1));
    expect(w.runner.to("room-1")[0]).toContain("what goes first?");
    expect(w.runner.to("room-2")).toHaveLength(1);
    expect(w.gateway.desks).toEqual([]);
  });

  it("does not claim a channel that is no roadmap's room, a shelved room or an established one — and reads each change at once", async () => {
    const claim = roomClaim(w.root, () => {});
    // No ledger at all yet.
    expect(claim(room("room_a"))).toBe(false);
    const n = await openA();
    expect(claim(room("room_b"))).toBe(false);
    expect(claim(room("room_a"))).toBe(true);
    await service.setArchived(PROJECT, ORG, n, true, BOSS);
    expect(claim(room("room_a"))).toBe(false);
    await service.setArchived(PROJECT, ORG, n, false, BOSS);
    expect(claim(room("room_a"))).toBe(true);
    await service.draft(
      PROJECT,
      ORG,
      n,
      {
        body: "## Why\n",
        items: [
          { key: "a", kind: "proposal", title: "T", brief: "B", owner: "acme_dev", cites: ["Why"] },
        ],
      },
      BOSS,
    );
    await service.establish(PROJECT, ORG, n, BOSS);
    expect(claim(room("room_a"))).toBe(false);
  });
});
