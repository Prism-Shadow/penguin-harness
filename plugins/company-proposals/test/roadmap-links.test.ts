/**
 * Which roadmaps a proposal belongs to (roadmap-links.ts): asked of the roadmaps plugin through
 * ProposalRoadmapLinks and carried on the reads — the queue's list and a proposal's detail, over
 * the read routes — as `roadmaps`, `[]` without a provider; grouped by proposal in roadmap
 * order; withdrawing the provider leaves a later one in place.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import { RoadmapLinks } from "../src/roadmap-links.js";
import { proposalRoutes, type ProposalRoadmapLinks } from "../src/index.js";
import { BOSS, ORG, PROJECT, fakeOrg } from "./fake-org.js";

describe("RoadmapLinks", () => {
  it("is empty without a provider and groups a provider's rows by proposal, in roadmap order", async () => {
    const links = new RoadmapLinks();
    expect((await links.byProposal(PROJECT, ORG, BOSS)).size).toBe(0);
    const asked: OrgActor[] = [];
    const rows: ProposalRoadmapLinks = async (_p, _o, actor) => {
      asked.push(actor);
      return [
        { proposal: 7, number: 4, name: "Later", itemKey: "pages" },
        { proposal: 7, number: 2, name: "Queue", itemKey: "ledger" },
        { proposal: 9, number: 2, name: "Queue", itemKey: "panel" },
      ];
    };
    const withdraw = links.provide(rows);
    const by = await links.byProposal(PROJECT, ORG, BOSS);
    expect(asked).toEqual([BOSS]);
    expect(by.get(7)).toEqual([
      { number: 2, name: "Queue", itemKey: "ledger" },
      { number: 4, name: "Later", itemKey: "pages" },
    ]);
    expect(by.get(9)).toEqual([{ number: 2, name: "Queue", itemKey: "panel" }]);
    // A later provider stays when the earlier one withdraws.
    const later: ProposalRoadmapLinks = async () => [];
    links.provide(later);
    withdraw();
    expect((await links.byProposal(PROJECT, ORG, BOSS)).size).toBe(0);
  });
});

describe("a proposal's roadmaps on the reads", () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let app: Hono;
  beforeEach(async () => {
    org = await fakeOrg();
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { userId: "boss" } as never);
      await next();
    });
    app.route("/p/:projectId/o/:orgId/proposals", proposalRoutes(org.service));
  });
  afterEach(async () => {
    await org.cleanup();
  });

  const read = async (suffix: string): Promise<Record<string, unknown>> => {
    const res = await app.request(`/p/${PROJECT}/o/${ORG}/proposals${suffix}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };

  it("carries the roadmaps on the list and the detail, and [] without the roadmaps plugin", async () => {
    const a = await org.service.create(PROJECT, ORG, { author: "acme_dev", brief: "One" }, BOSS);
    const b = await org.service.create(PROJECT, ORG, { author: "acme_dev", brief: "Two" }, BOSS);
    const bare = (await read("")).proposals as Array<{ number: number; roadmaps: unknown }>;
    expect(bare.map((p) => p.roadmaps)).toEqual([[], []]);
    expect((await read(`/${a.number}`)).roadmaps).toEqual([]);

    org.service.roadmapLinks.provide(async () => [
      { proposal: a.number, number: 3, name: "Queue", itemKey: "ledger" },
    ]);
    const listed = (await read("")).proposals as Array<{ number: number; roadmaps: unknown }>;
    expect(listed.find((p) => p.number === a.number)?.roadmaps).toEqual([
      { number: 3, name: "Queue", itemKey: "ledger" },
    ]);
    expect(listed.find((p) => p.number === b.number)?.roadmaps).toEqual([]);
    expect((await read(`/${a.number}`)).roadmaps).toEqual([
      { number: 3, name: "Queue", itemKey: "ledger" },
    ]);
  });
});
