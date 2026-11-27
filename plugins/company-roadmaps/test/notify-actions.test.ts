/**
 * The roadmap notices (notices.ts): an opening tells each employee's desk where it is (and a
 * change of members each new member of a discussing room), an establishment tells a derived
 * roadmap's moderator and its members and asks the moderator's desk for its approvals, an
 * item's last approval tells its owner (and the owners stacked on it learn the proposal's
 * number), a reopening tells every member's desk why — each through its notify Action, run by
 * key once the write committed, as the same caller. A company workflow's `action` on the key
 * replaces the built-in one, and the desk hears nothing.
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
/** A roadmap item: establishing derives a roadmap of its own, moderated by acme_qa. */
const DERIVED = {
  key: "tests",
  kind: "roadmap",
  title: "Test plan",
  brief: "How it is tested.",
  employees: ["acme_qa", "acme_dev"],
  cites: ["The ledger"],
};
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

async function discussing(items: unknown[] = ITEMS): Promise<Roadmap> {
  const { roadmap } = await service.create(PROJECT, ORG, OPEN, BOSS);
  await service.draft(PROJECT, ORG, roadmap.number, { body: BODY, items }, BOSS);
  return service.get(PROJECT, ORG, roadmap.number, BOSS);
}

/** A company workflow's action on `key` that delivers nothing, and says so. */
function quiet(
  key: string,
  subjects: string[],
  params: Record<string, string>,
  seen: string[],
  result: unknown = null,
): Contributed {
  return {
    id: `quiet.${key}`,
    from: "Workflow",
    workflow: "quiet",
    data: { kind: "action", key, subjects, params },
    code: {
      run: async (ctx) => {
        seen.push(`${ctx.key} ${ctx.subject.text} ${(ctx.params.to as string[]).join(",")}`);
        return result;
      },
    } satisfies ActionCode,
  };
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

  it("an opening tells each employee's desk where it is, each through its notice", async () => {
    app();
    const opened = await a.run("roadmap.open", "organization", OPEN);
    expect(opened.status).toBe(200);
    const sender = opened.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    // The runs are listed newest first; the notices went out in the room's order.
    const sent = (await sentBy("room_joined", sender)).sort((x, y) =>
      String((x.params.to as string[])[0]).localeCompare(String((y.params.to as string[])[0])),
    );
    expect(sent).toMatchObject([
      {
        contribution: ROADMAP_NOTICE_IDS.room_joined,
        subject: "roadmap:1",
        by: "user:boss",
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_dev"] },
      },
      {
        contribution: ROADMAP_NOTICE_IDS.room_joined,
        subject: "roadmap:1",
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_web"] },
      },
    ]);
    expect(w.gateway.desks.map((d) => [d.agentId, d.text.split("\n")[0]])).toEqual([
      [
        "acme_dev",
        "[roadmap #1 «Queue»] user:boss opened this roadmap and put you in its room `room_a` of organization `acme` (you moderate). Topic: Queue",
      ],
      [
        "acme_web",
        "[roadmap #1 «Queue»] user:boss opened this roadmap and put you in its room `room_a` of organization `acme` (acme_dev moderates). Topic: Queue",
      ],
    ]);
  });

  it("an establishment tells a derived roadmap's moderator through its notice, on the derived roadmap", async () => {
    app();
    const r = await discussing([...ITEMS, DERIVED]);
    const mark = w.gateway.desks.length;
    const est = await a.run("roadmap.establish", `roadmap:${r.number}`);
    expect(est.status).toBe(200);
    const sender = est.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    const after = (est.body.result as { roadmap: Roadmap }).roadmap;
    const child = after.delegations.tests!.child!;
    expect(await sentBy("derived", sender)).toMatchObject([
      {
        contribution: ROADMAP_NOTICE_IDS.derived,
        subject: `roadmap:${child}`,
        by: "user:boss",
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_qa"] },
      },
    ]);
    // The derived roadmap's moderator is told it derives (then this roadmap's moderator is
    // asked for its approvals), and every member of the derived room is told it is in it —
    // its moderator with the draft's commands.
    const told = w.gateway.desks.slice(mark);
    expect(told.map((d) => d.agentId)).toEqual(["acme_qa", "acme_dev", "acme_qa", "acme_dev"]);
    expect(told[0]!.text).toContain(`[roadmap #${child} «Test plan»]`);
    expect(told[0]!.text).toContain("Its room is open");
    expect(told[2]!.text).toContain(`[roadmap #${child} «Test plan»]`);
    expect(told[2]!.text).toContain("(you moderate)");
    expect(told[3]!.text).toContain("(acme_qa moderates)");
    expect(after.delegations.tests).toMatchObject({ owner: "acme_qa", delivered: true });
  });

  it("a reopening tells every member's desk why through one notice", async () => {
    app();
    const r = await discussing();
    await service.establish(PROJECT, ORG, r.number, BOSS);
    const mark = w.gateway.desks.length;
    const re = await a.run("roadmap.reopen", `roadmap:${r.number}`, {
      reason: "The ledger needs a migration first.",
    });
    expect(re.status).toBe(200);
    const sender = re.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    expect(await sentBy("reopened", sender)).toMatchObject([
      {
        contribution: ROADMAP_NOTICE_IDS.reopened,
        subject: `roadmap:${r.number}`,
        by: "user:boss",
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_dev", "acme_web"] },
      },
    ]);
    const told = w.gateway.desks.slice(mark);
    expect(told.map((d) => d.agentId)).toEqual(["acme_dev", "acme_web"]);
    for (const d of told) {
      expect(d.text).toContain("reopened by user:boss: The ledger needs a migration first.");
    }
  });

  it("a desk the reopening cannot reach is answered as a hint, the others told", async () => {
    app();
    const r = await discussing();
    await service.establish(PROJECT, ORG, r.number, BOSS);
    w.gateway.refuse.set("acme_web", "acme_web is paused.");
    const mark = w.gateway.desks.length;
    const re = await a.run("roadmap.reopen", `roadmap:${r.number}`, { reason: "Again." });
    expect(re.status).toBe(200);
    expect(re.body.run).toMatchObject({ outcome: "succeeded", hookErrors: [] });
    expect((re.body.result as { hints: string[] }).hints).toContain(
      "acme_web was not told: acme_web is paused.",
    );
    expect(w.gateway.desks.slice(mark).map((d) => d.agentId)).toEqual(["acme_dev"]);
  });

  it("an establishment asks the moderator's desk for its approvals through its notice", async () => {
    app();
    const r = await discussing();
    const mark = w.gateway.desks.length;
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
      params: { to: ["acme_dev"] },
    });
    const asked = w.gateway.desks.slice(mark);
    expect(asked.map((d) => d.agentId)).toEqual(["acme_dev"]);
    expect(asked[0]!.text).toMatch(/^\[roadmap #1 «Queue»\] established\. /);
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

  it("a company workflow's action on a notice's key replaces the built-in one: nobody's desk hears it", async () => {
    const seen: string[] = [];
    app([
      quiet("notify.roadmap.item_approved", ["item"], NOTICE_PARAMS, seen),
      quiet("notify.roadmap.base_linked", ["item"], NOTICE_PARAMS, seen),
      quiet("notify.roadmap.approval_requested", ["roadmap"], NOTICE_PARAMS, seen),
    ]);
    const r = await discussing();
    const asked = w.gateway.desks.length;
    expect((await a.run("roadmap.establish", `roadmap:${r.number}`)).status).toBe(200);
    expect(w.gateway.desks).toHaveLength(asked);
    const subject = `item:${r.number}/ledger`;
    await a.run("roadmap.item.approve", subject, {}, asAgent("acme_web"));
    const mark = w.gateway.desks.length;
    const last = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_dev"));
    expect(last.status).toBe(200);
    expect(w.gateway.desks.length).toBe(mark);
    expect(seen).toEqual([
      "notify.roadmap.approval_requested roadmap:1 acme_dev",
      "notify.roadmap.item_approved item:1/ledger acme_dev",
      "notify.roadmap.base_linked item:1/ledger acme_web",
    ]);
    expect((await runsOf("item_approved")).map((x) => [x.contribution, x.outcome])).toEqual([
      ["quiet.notify.roadmap.item_approved", "succeeded"],
    ]);
  });

  it("an opening, a derived roadmap and a reopening replaced: no desk hears them, and the delegation records what the replacement said", async () => {
    const seen: string[] = [];
    const nothing = { delivered: [], failed: [] };
    app([
      quiet("notify.roadmap.room_joined", ["roadmap"], NOTICE_PARAMS, seen, nothing),
      quiet("notify.roadmap.derived", ["roadmap"], NOTICE_PARAMS, seen, nothing),
      quiet("notify.roadmap.reopened", ["roadmap"], NOTICE_PARAMS, seen, nothing),
      quiet("notify.roadmap.approval_requested", ["roadmap"], NOTICE_PARAMS, seen, nothing),
    ]);
    const opened = await a.run("roadmap.open", "organization", OPEN);
    expect(opened.status).toBe(200);
    expect(opened.body.run).toMatchObject({ outcome: "succeeded", hookErrors: [] });
    expect(w.gateway.desks).toEqual([]);
    const n = (opened.body.result as { roadmap: Roadmap }).roadmap.number;
    await service.draft(PROJECT, ORG, n, { body: BODY, items: [...ITEMS, DERIVED] }, BOSS);
    const est = await a.run("roadmap.establish", `roadmap:${n}`);
    expect(est.status).toBe(200);
    expect(w.gateway.desks).toEqual([]);
    const after = (est.body.result as { roadmap: Roadmap }).roadmap;
    const child = after.delegations.tests!.child!;
    expect(after.delegations.tests).toMatchObject({ owner: "acme_qa", delivered: false });
    const re = await a.run("roadmap.reopen", `roadmap:${n}`, { reason: "Again." });
    expect(re.status).toBe(200);
    expect(w.gateway.desks).toEqual([]);
    expect(seen).toEqual([
      `notify.roadmap.room_joined roadmap:${n} acme_dev`,
      `notify.roadmap.room_joined roadmap:${n} acme_web`,
      `notify.roadmap.derived roadmap:${child} acme_qa`,
      `notify.roadmap.approval_requested roadmap:${n} acme_dev`,
      `notify.roadmap.room_joined roadmap:${child} acme_qa`,
      `notify.roadmap.room_joined roadmap:${child} acme_dev`,
      `notify.roadmap.reopened roadmap:${n} acme_dev,acme_web`,
    ]);
    expect((await runsOf("reopened")).map((x) => [x.contribution, x.outcome])).toEqual([
      ["quiet.notify.roadmap.reopened", "succeeded"],
    ]);
    expect((re.body.result as { roadmap: Roadmap }).roadmap.status).toBe("discussing");
  });

  it("a member added to a discussing room is told its room through room_joined, as the members run", async () => {
    app();
    const r = await discussing();
    const mark = w.gateway.desks.length;
    const ran = await a.run("roadmap.members", `roadmap:${r.number}`, {
      employees: ["acme_dev", "acme_web", "acme_qa"],
      moderator: "acme_dev",
    });
    expect(ran.status).toBe(200);
    const sender = ran.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    expect(await sentBy("room_joined", sender)).toMatchObject([
      {
        contribution: ROADMAP_NOTICE_IDS.room_joined,
        subject: `roadmap:${r.number}`,
        by: "user:boss",
        via: "notify",
        outcome: "succeeded",
        params: { to: ["acme_qa"] },
      },
    ]);
    expect(w.gateway.desks.slice(mark).map((d) => [d.agentId, d.text.split("\n")[0]])).toEqual([
      [
        "acme_qa",
        "[roadmap #1 «Queue»] user:boss made you a member of this roadmap, in its room `room_a` of organization `acme` (acme_dev moderates). Topic: Queue",
      ],
    ]);
  });

  it("a company workflow's room_joined replaces the built-in one for an added member too", async () => {
    const seen: string[] = [];
    app([
      quiet("notify.roadmap.room_joined", ["roadmap"], NOTICE_PARAMS, seen, {
        delivered: [],
        failed: [],
      }),
    ]);
    const r = await discussing();
    seen.length = 0;
    const mark = w.gateway.desks.length;
    const ran = await a.run("roadmap.members", `roadmap:${r.number}`, {
      employees: ["acme_web", "acme_qa"],
      moderator: "acme_qa",
    });
    expect(ran.status).toBe(200);
    expect(ran.body.run).toMatchObject({ outcome: "succeeded", hookErrors: [] });
    expect(seen).toEqual([`notify.roadmap.room_joined roadmap:${r.number} acme_qa`]);
    expect(w.gateway.desks).toHaveLength(mark);
    // The channel followed all the same: the notice is what was replaced, not the membership.
    expect(w.gateway.memberChanges.at(-1)).toMatchObject({
      add: ["acme_qa"],
      remove: ["acme_dev"],
    });
  });

  it("the manifest declares the six notices, each run only as a write's notice", async () => {
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
      runId: "x",
    });
    expect(direct.status).toBe(403);
  });
});
