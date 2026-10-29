// @vitest-environment jsdom
/**
 * The chat page's lookup of a routed Session the list does not hold
 * (features/chat/use-route-lookup.ts), driven through the hook as the page drives it.
 *
 * - Given a link opened while its machine is silent, the lookup's 404 is a doubt: the page says
 *   the machines are out of reach; once they answer, the Session is looked up again and opens.
 * - Given the same flow for a Session that really was deleted, the lookup made once the machines
 *   answered ends at not-found.
 * - Given the hub's 503 `machine_no_answer` while the list thinks every machine answered, the
 *   named machines are out of reach, the list is asked to read them again, and once it has,
 *   the Session is looked up again.
 * - Given a Session known to be on this server, its 404 is the verdict whatever machine of the
 *   Project is out of reach.
 * - Given a lookup that failed in doubt, the notice holds through a list round that asks other
 *   machines: it changes only when the silent machines change or the Session resolves.
 * - Given a hub that keeps answering `machine_no_answer` for a machine the list hears, the lookup
 *   is made again after a doubling wait (1 s, 2 s, 4 s …), and the list is asked to read the
 *   machines again for the first three doubts only.
 * - Given a socket that gave up on the routed machine (no machine named), the Session's own
 *   machine is said to be out of reach — not a skeleton that says nothing.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { useRouteLookup } from "../src/features/chat/use-route-lookup";
import type { RouteLookup, RouteLookupInput } from "../src/features/chat/use-route-lookup";
import { mount, settle, unmountAll } from "./helpers/dom";

beforeEach(() => {
  // Fake time that also moves with real time: the DOM helpers settle on a zero-delay timer.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
});

/** Lets the wait before a lookup is made again pass. */
const wait = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

type Row = { sessionId: string };

/** The lookups made, each answered by the test. */
function lookups() {
  const asked: Array<{ resolve: (row: Row | null) => void; reject: (err: unknown) => void }> = [];
  const lookup = () =>
    new Promise<Row | null>((resolve, reject) => {
      asked.push({ resolve, reject });
    });
  return { asked, lookup };
}

const notFound = () => new ApiError(404, "session_not_found", "no such Session");
const noAnswer = (machineId: string) =>
  new ApiError(503, "machine_no_answer", "did not answer", undefined, {
    machineId,
    alias: machineId,
  });

/** Mounts the hook under `props`; `update` changes them as the page's state would. */
async function page(initial: Partial<RouteLookupInput<Row>>) {
  let props: RouteLookupInput<Row> = {
    key: "p\u0000s1",
    listLoading: false,
    listed: false,
    deletedHere: false,
    owner: null,
    local: false,
    offline: [],
    asking: [],
    listRound: 0,
    lookup: async () => null,
    onFound: () => {},
    onMachinesSilent: () => {},
    ...initial,
  };
  const seen: { now: RouteLookup | null } = { now: null };
  // The input rides in one prop: React keeps `key` for itself and would not hand it over.
  function Probe({ input }: { input: RouteLookupInput<Row> }) {
    seen.now = useRouteLookup(input);
    return null;
  }
  const { rerender } = await mount(h(Probe, { input: props }));
  return {
    get state() {
      return seen.now!;
    },
    update: async (patch: Partial<RouteLookupInput<Row>>) => {
      props = { ...props, ...patch };
      await rerender(h(Probe, { input: props }));
      await settle();
    },
  };
}

describe("a link to a Session the list does not hold", () => {
  it("waits while its machine is silent, and opens once the machine answers", async () => {
    const { asked, lookup } = lookups();
    const found = vi.fn();
    const p = await page({ lookup, onFound: found, offline: ["m1"] });
    asked[0]!.reject(notFound());
    await settle();
    expect(p.state).toMatchObject({ pending: true, outOfReach: true, missing: false });

    await p.update({ offline: [] });
    // Still said while the lookup waits to be made again: no flash of a skeleton.
    expect(p.state.outOfReach).toBe(true);
    await wait(1_000);
    expect(asked).toHaveLength(2);
    asked[1]!.resolve({ sessionId: "s1" });
    await settle();
    expect(found).toHaveBeenCalledWith({ sessionId: "s1" }, false);
  });

  it("ends at not-found for a Session that really was deleted, once the machine has answered", async () => {
    const { asked, lookup } = lookups();
    const p = await page({ lookup, offline: ["m1"] });
    asked[0]!.reject(notFound());
    await settle();
    await p.update({ offline: [] });
    await wait(1_000);
    asked[1]!.reject(notFound());
    await settle();
    expect(p.state).toMatchObject({ pending: false, missing: true });
  });

  it("takes the hub's machine_no_answer as a doubt naming the machine, and asks again once the list has", async () => {
    const { asked, lookup } = lookups();
    const reread = vi.fn();
    const found = vi.fn();
    const p = await page({ lookup, onFound: found, onMachinesSilent: reread });
    asked[0]!.reject(noAnswer("m2"));
    await settle();
    expect(p.state).toMatchObject({ pending: true, outOfReach: true, silent: ["m2"] });
    expect(reread).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(1);

    // The list's next round heard m2 answer.
    await p.update({ listRound: 1 });
    await wait(1_000);
    expect(asked).toHaveLength(2);
    asked[1]!.resolve({ sessionId: "s1" });
    await settle();
    expect(found).toHaveBeenCalledTimes(1);
  });

  it("settles a Session known to be on this server by this server's 404, whatever machine is out of reach", async () => {
    const { asked, lookup } = lookups();
    const p = await page({ lookup, local: true, offline: ["m-dead"] });
    asked[0]!.reject(notFound());
    await settle();
    expect(p.state).toMatchObject({ pending: false, missing: true });
  });

  it("keeps saying the machines are out of reach through a list round that asks the others", async () => {
    const { asked, lookup } = lookups();
    const p = await page({ lookup, offline: ["m1"] });
    asked[0]!.reject(notFound());
    await settle();
    const seen = [p.state.outOfReach];
    await p.update({ asking: ["m2", "m3"] });
    seen.push(p.state.outOfReach);
    await p.update({ asking: [], listRound: 1 });
    seen.push(p.state.outOfReach);
    expect(seen).toEqual([true, true, true]);
    expect(p.state.silent).toEqual(["m1"]);
  });

  it("asks a hub that keeps not hearing a machine again after a doubling wait, and the list only thrice", async () => {
    const { asked, lookup } = lookups();
    const reread = vi.fn();
    const p = await page({ lookup, onMachinesSilent: reread });
    const waits: number[] = [];
    for (let round = 1; round <= 5; round += 1) {
      asked[asked.length - 1]!.reject(noAnswer("m2"));
      await settle();
      // The list's round hears m2.
      await p.update({ listRound: round });
      const before = asked.length;
      let waited = 0;
      while (asked.length === before && waited < 60_000) {
        await wait(500);
        waited += 500;
      }
      waits.push(waited);
    }
    // 1 s, doubling (to within the half-second steps the clock is moved in, which real time
    // nudges along as well).
    const doubling = [1_000, 2_000, 4_000, 8_000, 16_000];
    expect(waits.map((w, i) => Math.abs(w - doubling[i]!) <= 500)).toEqual(
      doubling.map(() => true),
    );
    expect(reread).toHaveBeenCalledTimes(3);
    expect(p.state.outOfReach).toBe(true);
  });

  it("says the Session's own machine is out of reach when the socket gave up on it", async () => {
    const { asked, lookup } = lookups();
    const p = await page({ lookup, owner: "m1" });
    asked[0]!.reject(new ApiError(0, "machine_no_answer", "network error"));
    await settle();
    expect(p.state).toMatchObject({ pending: true, outOfReach: true, silent: ["m1"] });
  });
});
