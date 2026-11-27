/**
 * `roadmap.item.add` and `roadmap.item.remove`: one item of a discussing roadmap's draft added
 * or removed, every other item, the record and the body left as they are. `roadmap.draft`
 * replaces the whole list, so a moderator adding one item had to read and write back every
 * other — and one that forgot to deleted them. Each is one `draft` write of the list with the
 * item appended or left out, under the same default guard as `roadmap.draft`.
 */
import type { OrgView } from "@prismshadow/penguin-server/plugin";
import { RoadmapError, type DraftItem, type Roadmap } from "./domain.js";
import type { Caller, WriteAct } from "./guards.js";
import { parseAddedItem } from "./items.js";
import type { RoadmapStore } from "./ports.js";

/** What an item edit runs on: the organization, the caller, the roadmap's store, its guard. */
export interface ItemEditScope {
  org: Pick<OrgView, "employees">;
  caller: Caller;
  store: RoadmapStore;
  act: WriteAct;
}

function requireRoadmap(store: RoadmapStore, number: number): Roadmap {
  const r = store.get(number);
  if (r === null) throw new RoadmapError(404, "roadmap_not_found", `No roadmap #${number}.`);
  return r;
}

function writeItems(s: ItemEditScope, number: number, items: DraftItem[]): Roadmap {
  s.store.write({ kind: "draft", number, items, by: s.caller.principal }, (now) =>
    s.act.check(now),
  );
  return requireRoadmap(s.store, number);
}

/** `roadmap.item.add`: `raw`, one item as an element of `roadmap.draft`'s items, appended. */
export function addItem(s: ItemEditScope, number: number, raw: unknown): Roadmap {
  const r = requireRoadmap(s.store, number);
  s.act.check(r);
  const item = parseAddedItem(raw, r.items, s.org);
  return writeItems(s, number, [...r.items, item]);
}

/**
 * `roadmap.item.remove`: item `key` left out of the draft — only while nothing stands on it: no
 * proposal adopted by it or linked to its delegation (unlink by reopening and changing the
 * draft is not this), and no other item stacked on it.
 */
export function removeItem(s: ItemEditScope, number: number, key: unknown): Roadmap {
  const r = requireRoadmap(s.store, number);
  s.act.check(r);
  if (typeof key !== "string" || key === "") {
    throw new RoadmapError(400, "bad_request", "key must name an item.");
  }
  const item = r.items.find((x) => x.key === key);
  if (item === undefined) {
    throw new RoadmapError(404, "item_not_found", `Roadmap #${number} has no item ${key}.`);
  }
  const proposal =
    (item.kind === "proposal" ? item.proposal : undefined) ?? r.delegations[key]?.proposal;
  if (proposal !== undefined) {
    throw new RoadmapError(
      409,
      "item_has_proposal",
      `Item ${key} stands for proposal #${proposal}: it is not removed from the roadmap.`,
    );
  }
  const stacked = r.items.filter((x) => x.kind === "proposal" && x.stackedOn === key);
  if (stacked.length > 0) {
    throw new RoadmapError(
      409,
      "item_stacked_on",
      `Items stacked on ${key}: ${stacked.map((x) => x.key).join(", ")}; restack them first.`,
    );
  }
  return writeItems(
    s,
    number,
    r.items.filter((x) => x.key !== key),
  );
}
