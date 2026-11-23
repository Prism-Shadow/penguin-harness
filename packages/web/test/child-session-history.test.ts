import { describe, expect, it } from "vitest";
import { ChildSessionHistory } from "../src/features/chat/child-session-history";

function child(sessionId: string, turnKey: string) {
  return {
    sessionId,
    turnKey,
    agentId: "researcher",
    spawnedAt: "2026-01-01T00:00:00Z",
    title: "Research",
  };
}

describe("the parent Session's child index", () => {
  it("fills a whole historical turn across page boundaries and preserves same-name children in server order", async () => {
    const records = [
      child("a", "three"),
      child("b", "two"),
      child("c", "two"),
      child("d", "two"),
      child("e", "one"),
    ];
    const requested: (string | undefined)[] = [];
    const history = new ChildSessionHistory(async (before) => {
      requested.push(before);
      const start = before ? records.findIndex((record) => record.sessionId === before) + 1 : 0;
      const items = records.slice(start, start + 2);
      return { items, nextCursor: start + 2 < records.length ? items.at(-1)!.sessionId : null };
    });
    await history.refresh();
    await history.completeTurn(null);
    expect(requested).toEqual([undefined]);
    await history.completeTurn("b");
    expect(history.items.map((record) => record.sessionId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(requested).toEqual([undefined, "b", "d"]);
    records.unshift(child("z", "four"), child("y", "four"), child("x", "four"));
    await history.refresh();
    expect(history.items.map((record) => record.sessionId)).toEqual([
      "z",
      "y",
      "x",
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(history.nextCursor).toBeNull();
  });

  it("retries after a failed continuation using the last complete cursor", async () => {
    let failed = false;
    const history = new ChildSessionHistory(async (before) => {
      if (!before) return { items: [child("a", "one")], nextCursor: "a" };
      if (!failed) {
        failed = true;
        throw new Error("Disconnected");
      }
      return { items: [child("b", "one")], nextCursor: null };
    });
    await history.refresh();
    await expect(history.completeTurn("a")).rejects.toThrow("Disconnected");
    expect(history.items.map((record) => record.sessionId)).toEqual(["a"]);
    await history.completeTurn("a");
    expect(history.items.map((record) => record.sessionId)).toEqual(["a", "b"]);
  });
});
