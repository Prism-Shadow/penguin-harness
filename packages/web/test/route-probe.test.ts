/**
 * The chat page's direct lookup of the routed Session (features/chat/route-probe.ts), driven
 * the way the page's effect drives it: each run first tells the probe which Session the route
 * names and whether the Session list is still loading, then asks for a lookup.
 *
 * - Given a lookup in flight, when the effect re-runs (the list churning), no second lookup is
 *   sent for the same Session.
 * - Given the lookup finds the Session, the page receives the row.
 * - Given a lookup that fails while the list is still loading, nothing is decided; when the
 *   list settles, the effect asks again, and that failure says the Session is gone.
 * - Given a lookup sent while the list was loading that fails after the list settled, the
 *   Session is gone: a deep link to a deleted Session leaves the skeleton.
 * - Given an answer the page may not show (a Session of another Project) after the list
 *   settled, the Session is gone.
 * - Given the route moved to another Session before a lookup settled, its answer changes
 *   nothing.
 */
import { describe, expect, it } from "vitest";
import { RouteProbe } from "../src/features/chat/route-probe";

interface Lookup {
  key: string;
  resolve(row: string | null): void;
  reject(err: unknown): void;
}

/** A page with the probe: `effect` is one run of its effect, `lookups` what it sent. */
function page() {
  const probe = new RouteProbe();
  const lookups: Lookup[] = [];
  const found: string[] = [];
  const gone: string[] = [];
  const effect = (key: string | null, listLoading: boolean) => {
    probe.track(key, listLoading);
    if (key === null) return;
    probe.run(
      key,
      () => new Promise<string | null>((resolve, reject) => lookups.push({ key, resolve, reject })),
      { found: (row) => found.push(row), gone: () => gone.push(key) },
    );
  };
  return { effect, lookups, found, gone };
}

/** Lets a settled lookup's handlers run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const notFound = new Error("404 not_found");

describe("the routed Session's direct lookup", () => {
  it("sends one lookup per Session however often the effect re-runs while it is in flight", () => {
    const p = page();
    p.effect("p:s1", true);
    p.effect("p:s1", true);
    p.effect("p:s1", false);
    expect(p.lookups.map((l) => l.key)).toEqual(["p:s1"]);
  });

  it("hands the page the row the lookup found", async () => {
    const p = page();
    p.effect("p:s1", true);
    p.lookups[0]!.resolve("row s1");
    await flush();
    expect(p.found).toEqual(["row s1"]);
    expect(p.gone).toEqual([]);
  });

  it("decides nothing on a failure while the list loads, and asks again once it has settled", async () => {
    const p = page();
    p.effect("p:s1", true);
    p.lookups[0]!.reject(notFound);
    await flush();
    expect(p.gone).toEqual([]);
    // The list settles: the effect re-runs, and a second lookup goes out.
    p.effect("p:s1", false);
    expect(p.lookups).toHaveLength(2);
    p.lookups[1]!.reject(notFound);
    await flush();
    expect(p.gone).toEqual(["p:s1"]);
  });

  it("takes a failure that arrives after the list settled as gone, though the lookup left while it loaded", async () => {
    const p = page();
    p.effect("p:s1", true);
    // The list settles while the lookup is still out: the effect re-runs and sends nothing.
    p.effect("p:s1", false);
    p.lookups[0]!.reject(notFound);
    await flush();
    // Nothing re-runs the effect after this, so a verdict missed here is never reached.
    expect(p.gone).toEqual(["p:s1"]);
    expect(p.lookups).toHaveLength(1);
  });

  it("takes an answer the page may not show, once the list has settled, as gone", async () => {
    const p = page();
    p.effect("p:s1", false);
    p.lookups[0]!.resolve(null);
    await flush();
    expect(p.found).toEqual([]);
    expect(p.gone).toEqual(["p:s1"]);
  });

  it("drops the answer about a Session the route has since left", async () => {
    const p = page();
    p.effect("p:s1", false);
    p.effect("p:s2", false);
    p.lookups[0]!.reject(notFound);
    p.lookups[1]!.resolve("row s2");
    await flush();
    expect(p.gone).toEqual([]);
    expect(p.found).toEqual(["row s2"]);
    // And a found row for the Session left behind is not shown in place of the routed one.
    const q = page();
    q.effect("p:s1", false);
    q.effect(null, false);
    q.lookups[0]!.resolve("row s1");
    await flush();
    expect(q.found).toEqual([]);
  });
});
