/**
 * The review behind Clean up temporary files (plugins/storage/src/web/storage-cleanup-state.ts),
 * driven through the real endpoint wrappers against the fetch fake.
 *
 * - Given a review, what the server picks is chosen to begin with, and the size chosen follows
 *   every change to the choice.
 * - Given a review asked again for another age, the choice stays on the items both reviews hold,
 *   and an item new to the review takes the server's pick.
 * - Given a review overtaken by a newer one, only the newer one lands.
 * - Given the choice removed, exactly the chosen ids go to the server with the age they were
 *   reviewed at, and the answer comes back whole; nothing chosen sends nothing.
 */
// The face's host first: the page calls the app's `apiFetch` and toasts through it.
import "../src/web-app/plugin-host";
import { afterEach, describe, expect, it } from "vitest";
import type { StorageCleanupItem } from "../../../plugins/storage/src/types";
import {
  chosenBytes,
  createCleanupStore,
} from "../../../plugins/storage/src/web/storage-cleanup-state";
import { json, stubFetch, type FakeFetch } from "./helpers/fetch";

const MB = 1024 ** 2;

function item(id: string, bytes: number, selected: boolean): StorageCleanupItem {
  return {
    id,
    kind: "scratchpad",
    reason: selected ? "orphan" : "idle",
    projectId: "p",
    projectName: "Project",
    agentId: "a",
    agentName: "Writer",
    name: id,
    bytes,
    lastModifiedAt: "2026-11-01T00:00:00.000Z",
    selected,
  };
}

/** The fake server's review per age asked, and the removals it was sent. */
let reviews: Record<number, StorageCleanupItem[]>;
let fetch: FakeFetch;

function serve() {
  fetch = stubFetch((request) => {
    if (request.path === "/api/me/storage/cleanup" && request.method === "GET") {
      const days = Number(request.query.get("olderThanDays"));
      return json({
        measuredAt: "2026-11-19T08:00:00.000Z",
        olderThanDays: days,
        items: reviews[days] ?? [],
      });
    }
    if (request.path === "/api/me/storage/cleanup" && request.method === "POST") {
      const ids = (request.body as { items: string[] }).items;
      return json({
        removed: ids.length - 1,
        bytes: 300 * MB,
        skipped: [{ id: ids[0], reason: "in_use" }],
      });
    }
    return json({}, 404);
  });
}

afterEach(() => {
  reviews = {};
});

describe("the cleanup review", () => {
  it("starts with the server's picks chosen, and the size chosen follows the choice", async () => {
    reviews = {
      7: [item("a", 100 * MB, true), item("b", 200 * MB, true), item("c", 50 * MB, false)],
    };
    serve();
    const store = createCleanupStore();
    await store.getState().load(7);
    expect([...store.getState().selected].sort()).toEqual(["a", "b"]);
    expect(chosenBytes(store.getState())).toBe(300 * MB);
    store.getState().setSelected(new Set(["b", "c"]));
    expect(chosenBytes(store.getState())).toBe(250 * MB);
  });

  it("keeps the choice on items both reviews hold, and takes the server's pick for a new one", async () => {
    reviews = {
      7: [item("a", 100 * MB, true), item("b", 200 * MB, false)],
      3: [item("a", 100 * MB, true), item("b", 200 * MB, false), item("d", 10 * MB, true)],
    };
    serve();
    const store = createCleanupStore();
    await store.getState().load(7);
    store.getState().setSelected(new Set(["b"]));
    await store.getState().load(3);
    expect([...store.getState().selected].sort()).toEqual(["b", "d"]);
  });

  it("lands only the newest review asked for", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    fetch = stubFetch(async (request) => {
      const days = Number(request.query.get("olderThanDays"));
      // The older review answers last.
      if (days === 7) await held;
      return json({
        measuredAt: "2026-11-19T08:00:00.000Z",
        olderThanDays: days,
        items: [item(days === 7 ? "a" : "z", 1, true)],
      });
    });
    const store = createCleanupStore();
    const older = store.getState().load(7);
    await store.getState().load(30);
    release();
    await older;
    expect(store.getState().review?.olderThanDays).toBe(30);
    expect(store.getState().review?.items.map((i) => i.id)).toEqual(["z"]);
  });

  it("sends exactly the chosen ids with the reviewed age, and nothing when none is chosen", async () => {
    reviews = { 14: [item("a", 100 * MB, true), item("b", 200 * MB, true), item("c", 5, false)] };
    serve();
    const store = createCleanupStore();
    await store.getState().load(14);
    const result = await store.getState().remove();
    const posts = fetch.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.body)).toEqual([{ items: ["a", "b"], olderThanDays: 14 }]);
    expect(result).toEqual({
      removed: 1,
      bytes: 300 * MB,
      skipped: [{ id: "a", reason: "in_use" }],
    });
    store.getState().setSelected(new Set());
    expect(await store.getState().remove()).toBeNull();
    expect(fetch.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });
});
