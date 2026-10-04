/**
 * The roadmap notices (notices.ts): an item's last approval tells its owner (and the owners
 * stacked on it learn the proposal's number), an establishment asks the moderator's room session
 * for its approvals — each through its notify Action, run by key once the write committed, as
 * the same caller. A company workflow's `action` on the key replaces the built-in one, and the
 * desk or the session hears nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActionCode, Contributed } from "@prismshadow/penguin-plugin-company-proposals";
import {
  ROADMAP_NOTICE_IDS,
  roadmapNoticeKey,
  type Roadmap,
  type RoadmapNoticeEvent,
  type RoadmapService,
} from "../src/index.js";
import { BOSS, ORG, PROJECT, asAgent, world, writeChannel, type World } from "./fakes.js";
import { PLUGIN_DIR, actionApp, type ActionApp } from "./action-harness.js";

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
  },
];
const OPEN = { name: "Queue", channelId: "room_a", employees: ["acme_dev", "acme_web"] };
const NOTICE_PARAMS = { to: "string[]", text: "string", runId: "string" };

interface RunView {
  id: string;
  contribution: string;
  subject: string;
  params: Record<string, unknown>;
  by: string;
  via: string;
  outcome: string | null;
  hookErrors: string[];
}

let w: World;
let service: RoadmapService;

beforeEach(async () => {
  w = await world();
  service = w.service();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
});

async function discussing(): Promise<Roadmap> {
  const { roadmap } = await service.create(PROJECT, ORG, OPEN, BOSS);
  await service.draft(PROJECT, ORG, roadmap.number, { body: BODY, items: ITEMS }, BOSS);
  return service.get(PROJECT, ORG, roadmap.number, BOSS);
}

describe("roadmap notices", () => {
  let a: ActionApp;
  const app = (company: Contributed[] = []) => {
    a = actionApp({ gateway: w.gateway, root: w.root, service, company });
    return a;
  };
  const runsOf = async (event: RoadmapNoticeEvent): Promise<RunView[]> =>
    (await a.get(`/p/${PROJECT}/o/${ORG}/actions/runs?key=${roadmapNoticeKey(event)}`)).body
      .runs as RunView[];
  /** The notices of `event` the run `sender` sent. */
  const sentBy = async (event: RoadmapNoticeEvent, sender: RunView) =>
    (await runsOf(event)).filter((r) => r.params.runId === sender.id);

  it("an establishment asks the moderator's room session for its approvals through its notice", async () => {
    app();
    const r = await discussing();
    const moderator = r.clones.find((c) => c.agentId === "acme_dev" && c.closedAt === undefined)!;
    const before = w.runner.to(moderator.sessionId).length;
    const est = await a.run("roadmap.establish", `roadmap:${r.number}`);
    expect(est.status).toBe(200);
    const sender = est.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    const sent = await sentBy("approval_requested", sender);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      contribution: ROADMAP_NOTICE_IDS.approval_requested,
      subject: `roadmap:${r.number}`,
      by: "user:boss",
      via: "notify",
      outcome: "succeeded",
      params: { to: ["acme_dev"], sessionId: moderator.sessionId },
    });
    const asked = w.runner.to(moderator.sessionId).slice(before);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^\[roadmap #1 «Queue»\] established\. /);
  });

  it("the last approval tells the owner, and the owner stacked on it learns the number, each through its notice", async () => {
    app();
    const r = await discussing();
    await service.establish(PROJECT, ORG, r.number, BOSS);
    const subject = `item:${r.number}/ledger`;
    expect((await a.run("roadmap.item.approve", subject, {}, asAgent("acme_web"))).status).toBe(
      200,
    );
    const mark = w.gateway.desks.length;
    const last = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_dev"));
    expect(last.status).toBe(200);
    const sender = last.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    expect(await sentBy("item_approved", sender)).toMatchObject([
      {
        contribution: ROADMAP_NOTICE_IDS.item_approved,
        subject,
        by: "agent:acme_dev",
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_dev"] },
      },
    ]);
    expect(await sentBy("base_linked", sender)).toMatchObject([
      {
        contribution: ROADMAP_NOTICE_IDS.base_linked,
        subject,
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_web"] },
      },
    ]);
    expect(w.gateway.desks.slice(mark)).toEqual([
      {
        agentId: "acme_dev",
        text: expect.stringMatching(
          /^\[roadmap #1 «Queue»\] Your item \[ledger\] "Roadmap ledger" is approved: /,
        ),
      },
      {
        agentId: "acme_web",
        text: '[roadmap #1 «Queue»] "Roadmap ledger", which your item [pages] "Ledger pages" is stacked on, is proposal #200 now: base your branch on that one\'s.',
      },
    ]);
    const after = (last.body.result as { roadmap: Roadmap }).roadmap;
    expect(after.delegations.ledger).toMatchObject({ stage: "delegated", delivered: true });
  });

  it("a desk the built-in notice cannot reach is recorded and answered as a hint, as before", async () => {
    app();
    const r = await discussing();
    await service.establish(PROJECT, ORG, r.number, BOSS);
    const subject = `item:${r.number}/ledger`;
    await a.run("roadmap.item.approve", subject, {}, asAgent("acme_web"));
    w.gateway.refuse.set("acme_dev", "acme_dev is paused.");
    const last = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_dev"));
    expect(last.status).toBe(200);
    expect(last.body.run).toMatchObject({ outcome: "succeeded", hookErrors: [] });
    const result = last.body.result as { roadmap: Roadmap; hints: string[] };
    expect(result.hints).toEqual(["acme_dev was not told: acme_dev is paused."]);
    expect(result.roadmap.delegations.ledger).toMatchObject({ delivered: false });
    expect(result.roadmap.events.some((e) => e.kind === "notify_failed")).toBe(true);
  });

  it("a company workflow's action on a notice's key replaces the built-in one: nobody's desk or session hears it", async () => {
    const seen: string[] = [];
    const quiet = (
      key: string,
      subjects: string[],
      params: Record<string, string> = NOTICE_PARAMS,
    ): Contributed => ({
      id: `quiet.${key}`,
      from: "Workflow",
      workflow: "quiet",
      data: { kind: "action", key, subjects, params },
      code: {
        run: async (ctx) => {
          seen.push(`${ctx.key} ${(ctx.params.to as string[]).join(",")}`);
          return null;
        },
      } satisfies ActionCode,
    });
    app([
      quiet("notify.roadmap.item_approved", ["item"]),
      quiet("notify.roadmap.base_linked", ["item"]),
      quiet("notify.roadmap.approval_requested", ["roadmap"], {
        ...NOTICE_PARAMS,
        sessionId: "string",
      }),
    ]);
    const r = await discussing();
    const moderator = r.clones.find((c) => c.agentId === "acme_dev" && c.closedAt === undefined)!;
    const asked = w.runner.to(moderator.sessionId).length;
    expect((await a.run("roadmap.establish", `roadmap:${r.number}`)).status).toBe(200);
    expect(w.runner.to(moderator.sessionId)).toHaveLength(asked);
    const subject = `item:${r.number}/ledger`;
    await a.run("roadmap.item.approve", subject, {}, asAgent("acme_web"));
    const mark = w.gateway.desks.length;
    const last = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_dev"));
    expect(last.status).toBe(200);
    expect(w.gateway.desks.length).toBe(mark);
    expect(seen).toEqual([
      "notify.roadmap.approval_requested acme_dev",
      "notify.roadmap.item_approved acme_dev",
      "notify.roadmap.base_linked acme_web",
    ]);
    expect((await runsOf("item_approved")).map((x) => [x.contribution, x.outcome])).toEqual([
      ["quiet.notify.roadmap.item_approved", "succeeded"],
    ]);
  });

  it("the manifest declares the three notices, each run only as a write's notice", async () => {
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<
        string,
        { contributes: Record<string, Array<{ id: string; kind: string; key?: string }>> }
      >;
    };
    const declared =
      table.modules.CompanyRoadmapsPlugin?.contributes["CompanyActionRegistry.actions"] ?? [];
    for (const [event, id] of Object.entries(ROADMAP_NOTICE_IDS)) {
      expect(declared.find((d) => d.id === id)).toMatchObject({
        kind: "action",
        key: roadmapNoticeKey(event as RoadmapNoticeEvent),
      });
    }
    app();
    const r = await discussing();
    const direct = await a.run("notify.roadmap.approval_requested", `roadmap:${r.number}`, {
      to: ["acme_dev"],
      text: "x",
      sessionId: "room-1",
      runId: "x",
    });
    expect(direct.status).toBe(403);
  });
});
