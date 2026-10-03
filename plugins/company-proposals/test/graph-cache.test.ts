import { describe, expect, it } from "vitest";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import { GRAPH_FRESH_MS, GraphCache } from "../src/graph-cache.js";

const graph = (n: number) => ({ checkedAt: String(n) }) as unknown as ProposalGraphResponse;

function deferred() {
  let resolve!: (g: ProposalGraphResponse) => void;
  const promise = new Promise<ProposalGraphResponse>((r) => (resolve = r));
  return { promise, resolve };
}

describe("GraphCache", () => {
  it("shares one cold read between concurrent requests", async () => {
    const cache = new GraphCache(() => 0);
    const d = deferred();
    let reads = 0;
    const read = () => (reads++, d.promise);
    const a = cache.get("k", "in", read);
    const b = cache.get("k", "in", read);
    d.resolve(graph(1));
    expect(await a).toBe(await b);
    expect(reads).toBe(1);
  });

  it("answers the last graph at once and refreshes it in the background once stale", async () => {
    let now = 0;
    const cache = new GraphCache(() => now);
    await cache.get("k", "in", async () => graph(1));
    now = GRAPH_FRESH_MS;
    const d = deferred();
    let reads = 0;
    const slow = () => (reads++, d.promise);
    expect(await cache.get("k", "in", slow)).toEqual(graph(1));
    expect(await cache.get("k", "in", slow)).toEqual(graph(1));
    expect(reads).toBe(1);
    d.resolve(graph(2));
    await d.promise;
    expect(await cache.get("k", "in", slow)).toEqual(graph(2));
  });

  it("waits for a read when the ledger input changed", async () => {
    const cache = new GraphCache(() => 0);
    await cache.get("k", "a", async () => graph(1));
    expect(await cache.get("k", "b", async () => graph(2))).toEqual(graph(2));
  });

  it("keeps the last graph when a background refresh fails", async () => {
    let now = 0;
    const cache = new GraphCache(() => now);
    await cache.get("k", "in", async () => graph(1));
    now = GRAPH_FRESH_MS;
    expect(await cache.get("k", "in", () => Promise.reject(new Error("gh down")))).toEqual(
      graph(1),
    );
    await Promise.resolve();
    expect(await cache.get("k", "in", async () => graph(3))).toEqual(graph(1));
  });
});
