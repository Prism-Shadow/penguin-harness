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
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { useRouteLookup } from "../src/features/chat/use-route-lookup";
import type { RouteLookup, RouteLookupInput } from "../src/features/chat/use-route-lookup";
import { mount, settle, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
});

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
  function Probe(p: RouteLookupInput<Row>) {
    seen.now = useRouteLookup(p);
    return null;
  }
  const { rerender } = await mount(h(Probe, props));
  return {
    get state() {
      return seen.now!;
    },
    update: async (patch: Partial<RouteLookupInput<Row>>) => {
      props = { ...props, ...patch };
      await rerender(h(Probe, props));
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
});
