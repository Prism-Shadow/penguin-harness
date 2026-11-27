/**
 * The built-in roadmap Actions: each default guard but `roadmap.members`'s answers a person and
 * an employee alike for the same state; the roles an item's brief is approved in are the default ones until a company
 * workflow replaces the guard of `roadmap.item.approve` and hands the default other roles; an
 * approval counts only on the brief it was read on; and the manifest declares exactly the Actions builtin-actions.ts implements.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ROADMAP_ACTION_IDS,
  ROADMAP_NOTICE_IDS,
  ROADMAP_SUBJECTS_ID,
  roadmapGuards,
  withApprovalRoles,
  type Roadmap,
  type RoadmapService,
} from "../src/index.js";
import { BOSS, ORG, PROJECT, asAgent, world, writeChannel, type World } from "./fakes.js";
import { PLUGIN_DIR, actionApp, codeOf, type ActionApp } from "./action-harness.js";

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
];
const OPEN = { name: "Queue", channelId: "room_a", employees: ["acme_dev", "acme_web"] };

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

async function established(): Promise<Roadmap> {
  const r = await discussing();
  await service.establish(PROJECT, ORG, r.number, BOSS);
  return service.get(PROJECT, ORG, r.number, BOSS);
}

/** A guard's answer: "allowed", or the refusal's code. */
function answer(key: string, state: Roadmap, subject: string, agentId: string | null): string {
  const [kind, id] = subject.split(":") as [string, string];
  try {
    roadmapGuards[key]!({
      caller: {
        principal: agentId === null ? "user:boss" : `agent:${agentId}`,
        agentId,
        userId: "boss",
      },
      subject: { kind, id, text: subject },
      state,
      params: {},
      running: 0,
    });
    return "allowed";
  } catch (err) {
    return (err as { code: string }).code;
  }
}

describe("the default guards", () => {
  it("answer a person and an employee (neither the moderator nor an owner) alike", async () => {
    const open = await discussing();
    const est = await established();
    const cases: Array<[string, Roadmap, string]> = [
      ["roadmap.open", open, "organization"],
      ["roadmap.draft", open, `roadmap:${open.number}`],
      ["roadmap.draft", est, `roadmap:${est.number}`],
      ["roadmap.item.add", open, `roadmap:${open.number}`],
      ["roadmap.item.add", est, `roadmap:${est.number}`],
      ["roadmap.item.remove", open, `roadmap:${open.number}`],
      ["roadmap.item.remove", est, `roadmap:${est.number}`],
      ["roadmap.establish", open, `roadmap:${open.number}`],
      ["roadmap.establish", est, `roadmap:${est.number}`],
      ["roadmap.item.approve", est, `item:${est.number}/ledger`],
      ["roadmap.item.approve", open, `item:${open.number}/ledger`],
      ["roadmap.item.link", est, `item:${est.number}/ledger`],
      ["roadmap.adopt", open, `roadmap:${open.number}`],
      ["roadmap.reopen", est, `roadmap:${est.number}`],
      ["roadmap.reopen", open, `roadmap:${open.number}`],
      ["roadmap.rename", open, `roadmap:${open.number}`],
      ["roadmap.room", open, `roadmap:${open.number}`],
    ];
    // `roadmap.members` is the one default that tells them apart: a person or the moderator
    // (members.test.ts).
    for (const key of Object.keys(ROADMAP_ACTION_IDS)) {
      expect(key === "roadmap.members" || cases.some(([k]) => k === key)).toBe(true);
    }
    for (const [key, state, subject] of cases) {
      const person = answer(key, state, subject, null);
      expect([key, subject, answer(key, state, subject, "acme_qa")]).toEqual([
        key,
        subject,
        person,
      ]);
    }
    // And the answers are the status rules, nothing about who asks.
    expect(answer("roadmap.establish", est, `roadmap:${est.number}`, null)).toBe("not_discussing");
    expect(answer("roadmap.reopen", open, `roadmap:${open.number}`, "acme_qa")).toBe(
      "not_established",
    );
    expect(answer("roadmap.room", open, `roadmap:${open.number}`, null)).toBe("not_awaiting_room");
  });

  it("refuse only an item's own owner linking it while it is a brief", async () => {
    const est = await established();
    const subject = `item:${est.number}/ledger`;
    expect(answer("roadmap.item.link", est, subject, "acme_dev")).toBe("not_approved");
    expect(answer("roadmap.item.link", est, subject, "acme_web")).toBe("allowed");
    expect(answer("roadmap.item.link", est, subject, null)).toBe("allowed");
  });

  it("count an approval only on the brief it was read on", async () => {
    const est = await established();
    const guard = roadmapGuards["roadmap.item.approve"]!;
    const input = {
      caller: { principal: "user:boss", agentId: null, userId: "boss" },
      subject: { kind: "item", id: `${est.number}/ledger`, text: `item:${est.number}/ledger` },
      state: est,
      running: 0,
    };
    expect(() => guard({ ...input, params: { brief: ITEMS[0]!.brief } })).not.toThrow();
    let refused: unknown = null;
    try {
      guard({ ...input, params: { brief: "Another brief." } });
    } catch (err) {
      refused = err;
    }
    expect(refused).toMatchObject({ status: 409, code: "brief_changed" });
  });
});

describe("the approval roles", () => {
  let a: ActionApp;
  beforeEach(() => {
    a = actionApp({ gateway: w.gateway, root: w.root, service });
  });

  it("default to the moderator and another member, a person or an employee", async () => {
    const est = await established();
    const subject = `item:${est.number}/ledger`;
    const member = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_web"));
    expect(member.status).toBe(200);
    const last = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_dev"));
    expect(last.status).toBe(200);
    expect(w.proposals.created).toHaveLength(1);
    const r = (last.body.result as { roadmap: Roadmap }).roadmap;
    expect(Object.keys(r.delegations.ledger!.approvals).sort()).toEqual(["member", "moderator"]);
  });

  it("follow a company workflow's replacement guard: a moderator and a person, an employee member is refused", async () => {
    const est = await established();
    a = actionApp({
      gateway: w.gateway,
      root: w.root,
      service,
      company: [
        {
          id: "acme.item-approve-roles",
          from: "Workflow",
          data: { kind: "guard", key: "roadmap.item.approve" },
          code: withApprovalRoles(["moderator", "person"]),
          workflow: "acme",
        },
      ],
    });
    const subject = `item:${est.number}/ledger`;
    const employee = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_web"));
    expect([employee.status, codeOf(employee)]).toEqual([403, "not_approver"]);
    const person = await a.run("roadmap.item.approve", subject, {}, BOSS);
    expect(person.status).toBe(200);
    const r = (person.body.result as { roadmap: Roadmap }).roadmap;
    expect(r.delegations.ledger!.approvals).toMatchObject({ person: { by: "user:boss" } });
    const last = await a.run("roadmap.item.approve", subject, {}, asAgent("acme_dev"));
    expect((last.body.result as { roadmap: Roadmap }).roadmap.delegations.ledger).toMatchObject({
      stage: "delegated",
      proposal: 200,
    });
  });
});

describe("the manifest", () => {
  it("declares exactly the Actions builtin-actions.ts implements, their notices, and the subject resolver", () => {
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<
        string,
        { contributes: Record<string, Array<{ id: string; kind: string; key?: string }>> }
      >;
    };
    const declared =
      table.modules.CompanyRoadmapsPlugin?.contributes["CompanyActionRegistry.actions"] ?? [];
    expect(declared.map((d) => d.id).sort()).toEqual(
      [
        ...Object.values(ROADMAP_ACTION_IDS),
        ...Object.values(ROADMAP_NOTICE_IDS),
        ROADMAP_SUBJECTS_ID,
      ].sort(),
    );
    for (const [key, id] of Object.entries(ROADMAP_ACTION_IDS)) {
      expect(declared.find((d) => d.id === id)).toMatchObject({ kind: "action", key });
    }
    expect(declared.find((d) => d.id === ROADMAP_SUBJECTS_ID)).toMatchObject({ kind: "subject" });
  });
});
