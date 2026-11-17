/**
 * Workbench actions through the same request handler the installed page calls.
 *
 * - A stale window cannot spend the last portion of an ingredient twice. Invalid edits leave the item intact.
 * - A table keeps its active seat across arrivals and starts a new round on wrap. A roll records its dice and modifier.
 * - A late guess cannot change a team's score. Ending the turn banks its points and hands the screen to the other team.
 * - A second draw for one day keeps the slip and its note, including after the workbench is reopened.
 * - Completing an action in one meeting leaves the other meeting and its decisions alone.
 */
import { describe, expect, it, vi } from "vitest";

type Action = Record<string, unknown>;
type Result = { status?: number; body: { revision: number; state: unknown } };
// Each install has only its own document and never contacts a model.
async function open(id: string) {
  const { default: app } = await import(`../../../plugins/${id}/workbenches/${id}/index.ts`);
  let data: unknown = null;
  const host = {
    getState: () => data,
    setState: async (next: unknown) => {
      data = structuredClone(next);
    },
  };
  const session = () => app.modules.Workbench.create({ use: { host } }).api.main;
  let main = session(),
    revision = 0;
  async function send(action: Action, at = revision): Promise<Result> {
    const res = await main.handle({
      method: "POST",
      path: "/state",
      body: { revision: at, ...action },
    });
    if (!res.status) revision = res.body.revision;
    return res;
  }
  const state = async () => (await main.handle({ method: "GET", path: "/state" })).body.state;
  return {
    send,
    state,
    reopen() {
      main = session();
    },
  };
}

describe("the desk workbenches", () => {
  it("spends a portion once across competing windows and preserves stock after an invalid edit", async () => {
    const f = await open("fridge-keeper");
    const item = { name: "Milk", count: 2, unit: "cartons", zone: "chilled", day: "2026-11-22" };
    await f.send({ type: "add", ...item });
    const results = await Promise.all([
      f.send({ type: "use", id: 1 }, 1),
      f.send({ type: "use", id: 1 }, 1),
    ]);
    expect(results.map((r) => r.status ?? 200).sort()).toEqual([200, 409]);
    expect((await f.send({ type: "edit", id: 1, ...item, day: "2026-02-31" })).status).toBe(400);
    expect(await f.state()).toMatchObject({ items: [{ ...item, count: 1 }] });
  });
  it("preserves the active seat, wraps the round and logs a bounded roll", async () => {
    const f = await open("tabletop-desk");
    await f.send({ type: "join", name: "Brook", initiative: 15 });
    await f.send({ type: "join", name: "Moss", initiative: 7 });
    await f.send({ type: "next" });
    expect(await f.state()).toMatchObject({ round: 1, active: 2 });
    await f.send({ type: "roll", count: 3, sides: 6, modifier: -2 });
    const [roll] = (await f.state()).rolls;
    expect(roll.who).toBe("Moss");
    expect(roll.dice).toHaveLength(3);
    expect(roll.dice.every((v: number) => v >= 1 && v <= 6)).toBe(true);
    expect(roll.total).toBe(roll.dice.reduce((s: number, v: number) => s + v, -2));
    await f.send({ type: "next" });
    expect(await f.state()).toMatchObject({ round: 2, active: 1 });
  });
  it("rejects an expired guess then hands the next team a fresh turn", async () => {
    const f = await open("party-charades");
    vi.useFakeTimers();
    try {
      await f.send({ type: "start", seconds: 30 });
      const first = (await f.state()).word;
      await f.send({ type: "correct" });
      expect((await f.state()).word).not.toEqual(first);
      vi.advanceTimersByTime(30_001);
      expect((await f.send({ type: "correct" })).status).toBe(400);
      await f.send({ type: "end" });
      expect(await f.state()).toMatchObject({ score: [1, 0], team: 1, until: 0, word: null });
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps a daily slip and its reflection after a repeat draw and a reopen", async () => {
    const f = await open("daily-draw"),
      day = "2026-11-18";
    await f.send({ type: "draw", day });
    const original = (await f.state()).draws[0];
    await f.send({ type: "note", day, note: "A bird by the window" });
    f.reopen();
    await f.send({ type: "draw", day });
    expect((await f.state()).draws).toEqual([{ ...original, note: "A bird by the window" }]);
    await f.send({ type: "draw", day: "2026-11-19" });
    expect((await f.state()).draws[0].index).not.toBe(original.index);
  });
  it("completes one meeting's action without changing another meeting's decisions", async () => {
    const f = await open("action-minutes");
    for (const title of ["Review", "Planning"])
      await f.send({ type: "meeting", title, day: "2026-11-18" });
    await f.send({ type: "decision", meeting: 2, label: "Keep Friday free" });
    await f.send({ type: "task", meeting: 1, label: "Send the notes", owner: "Sam", due: "" });
    expect((await f.send({ type: "toggle", meeting: 2, id: 3 })).status).toBe(400);
    await f.send({ type: "toggle", meeting: 1, id: 3 });
    expect((await f.state()).meetings).toMatchObject([
      { decisions: ["Keep Friday free"], tasks: [] },
      { tasks: [{ done: true, owner: "Sam" }] },
    ]);
  });
});
