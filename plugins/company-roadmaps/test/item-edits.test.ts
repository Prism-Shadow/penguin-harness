/**
 * `roadmap.item.add` and `roadmap.item.remove` (item-edits.ts), run as Actions: one item appended
 * or removed while every other item, the record and the body stay; an existing key refused 409
 * `item_exists`, an item that stands for a proposal or that another is stacked on refused 409;
 * the same status rule as `roadmap.draft`; and `roadmap.draft`'s answer naming the keys its
 * whole-list replacement removed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DraftItem } from "../src/index.js";
import { asAgent, world, writeChannel, type World } from "./fakes.js";
import { actionApp, codeOf, type ActionApp } from "./action-harness.js";

const BODY = "## The ledger\nOne file per organization.\n";
const LEDGER = {
  key: "ledger",
  kind: "proposal",
  title: "Roadmap ledger",
  brief: "An append-only ledger.",
  owner: "acme_dev",
  cites: ["The ledger"],
};
const PAGES = { ...LEDGER, key: "pages", title: "Ledger pages", owner: "acme_web" };
const MOD = asAgent("acme_dev");

let w: World;
let a: ActionApp;

beforeEach(async () => {
  w = await world();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
  a = actionApp({ gateway: w.gateway, root: w.root, service: w.service() });
  await a.run("roadmap.open", "organization", {
    name: "Queue",
    channelId: "room_a",
    employees: ["acme_dev", "acme_web"],
  });
  await a.run(
    "roadmap.draft",
    "roadmap:1",
    { record: "Agreed so far.", body: BODY, items: [LEDGER] },
    MOD,
  );
});

type Result = { roadmap: { record: string; body: string; items: DraftItem[]; status: string } };
const resultOf = (r: { body: Record<string, unknown> }) => r.body.result as Result;
const keys = (r: { body: Record<string, unknown> }) => resultOf(r).roadmap.items.map((i) => i.key);

describe("roadmap.item.add", () => {
  it("appends one item and leaves the other items, the record and the body as they were", async () => {
    const added = await a.run(
      "roadmap.item.add",
      "roadmap:1",
      { ...PAGES, stackedOn: "ledger" },
      MOD,
    );
    expect(added.status).toBe(200);
    expect(keys(added)).toEqual(["ledger", "pages"]);
    const { roadmap } = resultOf(added);
    expect(roadmap.record).toBe("Agreed so far.");
    expect(roadmap.body).toBe(BODY);
    expect(roadmap.items[0]).toEqual(LEDGER);
    expect(roadmap.items[1]).toMatchObject({
      key: "pages",
      owner: "acme_web",
      stackedOn: "ledger",
    });
  });

  it("refuses a key the draft has (409 item_exists) and checks the item as roadmap.draft does", async () => {
    const again = await a.run("roadmap.item.add", "roadmap:1", LEDGER, MOD);
    expect([again.status, codeOf(again)]).toEqual([409, "item_exists"]);
    const nulled = await a.run("roadmap.item.add", "roadmap:1", { ...PAGES, proposal: null }, MOD);
    expect([nulled.status, codeOf(nulled)]).toEqual([400, "bad_request"]);
    expect((nulled.body.error as { message: string }).message).toContain(
      "item.proposal must be a proposal number",
    );
    const stranger = await a.run(
      "roadmap.item.add",
      "roadmap:1",
      { ...PAGES, owner: "ghost" },
      MOD,
    );
    expect([stranger.status, codeOf(stranger)]).toEqual([400, "bad_request"]);
  });

  it("is refused once the roadmap is established, as the draft is", async () => {
    await a.run("roadmap.establish", "roadmap:1", {}, MOD);
    const late = await a.run("roadmap.item.add", "roadmap:1", PAGES, MOD);
    expect([late.status, codeOf(late)]).toEqual([409, "not_discussing"]);
  });
});

describe("roadmap.item.remove", () => {
  it("removes one item that stands for no proposal, the rest untouched", async () => {
    await a.run("roadmap.item.add", "roadmap:1", PAGES, MOD);
    const removed = await a.run("roadmap.item.remove", "roadmap:1", { key: "pages" }, MOD);
    expect(removed.status).toBe(200);
    expect(keys(removed)).toEqual(["ledger"]);
    expect(resultOf(removed).roadmap.record).toBe("Agreed so far.");
    const missing = await a.run("roadmap.item.remove", "roadmap:1", { key: "pages" }, MOD);
    expect([missing.status, codeOf(missing)]).toEqual([404, "item_not_found"]);
  });

  it("refuses an item that stands for a proposal, or that another is stacked on", async () => {
    await a.run(
      "roadmap.item.add",
      "roadmap:1",
      {
        key: "old",
        kind: "proposal",
        title: "Old one",
        brief: "Old one",
        owner: "acme_web",
        proposal: 107,
      },
      MOD,
    );
    const adopted = await a.run("roadmap.item.remove", "roadmap:1", { key: "old" }, MOD);
    expect([adopted.status, codeOf(adopted)]).toEqual([409, "item_has_proposal"]);
    await a.run("roadmap.item.add", "roadmap:1", { ...PAGES, stackedOn: "ledger" }, MOD);
    const base = await a.run("roadmap.item.remove", "roadmap:1", { key: "ledger" }, MOD);
    expect([base.status, codeOf(base)]).toEqual([409, "item_stacked_on"]);
  });

  it("refuses an established item linked to a proposal, even after a reopening", async () => {
    await a.run("roadmap.establish", "roadmap:1", {}, MOD);
    await a.run("roadmap.item.approve", "item:1/ledger", {}, MOD);
    const approved = await a.run("roadmap.item.approve", "item:1/ledger", {});
    expect(approved.status).toBe(200);
    await a.run("roadmap.reopen", "roadmap:1", { reason: "One more item." }, MOD);
    const linked = await a.run("roadmap.item.remove", "roadmap:1", { key: "ledger" }, MOD);
    expect([linked.status, codeOf(linked)]).toEqual([409, "item_has_proposal"]);
  });
});

describe("roadmap.draft", () => {
  it("names the keys its whole-list replacement removed", async () => {
    await a.run("roadmap.item.add", "roadmap:1", PAGES, MOD);
    const replaced = await a.run("roadmap.draft", "roadmap:1", { items: [PAGES] }, MOD);
    expect(replaced.status).toBe(200);
    expect((replaced.body.result as { removed: string[] }).removed).toEqual(["ledger"]);
    const recordOnly = await a.run("roadmap.draft", "roadmap:1", { record: "More." }, MOD);
    expect((recordOnly.body.result as { removed: string[] }).removed).toEqual([]);
  });
});
