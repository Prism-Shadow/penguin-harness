/**
 * Where the open question's answers in progress are kept (lib/a2ui-drafts.ts): an entry comes
 * back until it is a week old, a write keeps the newest fifty, and storage that refuses every
 * call costs the drafts, never the page. Plus the wiring no static render reaches: the chat page
 * hands this store, scoped by Session, to the A2UI blocks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { A2UI_DRAFT_LIMIT, A2UI_DRAFT_MAX_AGE_MS, a2uiDrafts } from "../src/lib/a2ui-drafts";
import { blockedStorage, stubLocalStorage } from "./helpers/storage";

const PREFIX = "penguin.a2uiDraft.";
const entry = (at: number) => JSON.stringify({ v: 1, at, state: ["a"] });

describe("a2uiDrafts", () => {
  it("reads an entry back until it is a week old, then drops it", () => {
    const storage = stubLocalStorage();
    a2uiDrafts.save("s1:abc", { name: "billing" });
    expect(a2uiDrafts.load("s1:abc")).toEqual({ name: "billing" });
    storage.setItem(`${PREFIX}s1:old`, entry(Date.now() - A2UI_DRAFT_MAX_AGE_MS - 60_000));
    expect(a2uiDrafts.load("s1:old")).toBeUndefined();
    expect(storage.map.has(`${PREFIX}s1:old`)).toBe(false);
  });

  it("keeps the newest fifty entries on a write, and nothing else of the page's", () => {
    const storage = stubLocalStorage();
    const now = Date.now();
    for (let i = 0; i < A2UI_DRAFT_LIMIT + 5; i += 1) {
      storage.setItem(`${PREFIX}s1:${i}`, entry(now - (i + 1) * 1000));
    }
    storage.setItem("penguin.other", "kept");
    a2uiDrafts.save("s1:new", ["b"]);
    const kept = [...storage.map.keys()].filter((key) => key.startsWith(PREFIX));
    expect(kept).toHaveLength(A2UI_DRAFT_LIMIT);
    expect(kept).toContain(`${PREFIX}s1:new`);
    // The new entry and the 49 newest seeded ones stay; the six oldest made room.
    expect(kept).toContain(`${PREFIX}s1:48`);
    expect(kept).not.toContain(`${PREFIX}s1:49`);
    expect(storage.map.get("penguin.other")).toBe("kept");
  });

  it("never throws when storage refuses every call", () => {
    stubLocalStorage(blockedStorage());
    expect(() => a2uiDrafts.save("s1:abc", ["a"])).not.toThrow();
    expect(a2uiDrafts.load("s1:abc")).toBeUndefined();
    expect(() => a2uiDrafts.clear("s1:abc")).not.toThrow();
  });
});

describe("the chat page", () => {
  it("hands the store, scoped by Session, to the open question's blocks", () => {
    const page = readFileSync(
      new URL("../src/features/chat/chat-page.tsx", import.meta.url),
      "utf8",
    );
    const actions = /const a2uiActions = useMemo<A2uiActions>\(([\s\S]*?)\n {2}\);/.exec(page);
    expect(actions?.[1]).toContain("drafts: a2uiDrafts");
    expect(actions?.[1]).toContain("draftScope: selectedSessionId");
  });
});
