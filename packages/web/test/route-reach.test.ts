/**
 * What a failed lookup of the routed Session settles (features/chat/route-reach.ts), which is
 * what the chat page shows for a link to a conversation the list does not hold.
 *
 * - Given every server that could hold the Session answering, this server's 404 is the verdict:
 *   the Session does not exist. Any other failure settles nothing about the Session.
 * - Given a machine that could hold it out of reach — no connection, or silent in the list's
 *   last round — the same 404 is only "not here": no verdict, asked again once it answers.
 * - Given a machine still being asked, nothing is settled yet either.
 * - Given the Session's machine on record, only that machine's standing counts: another machine
 *   out of reach does not hold up a verdict about a Session it does not have.
 * - Given a lookup that failed in doubt, the Session stays looked for even once the silent machine
 *   answers, until the lookup is made again: the page never takes the stale failure for a verdict
 *   and opens another conversation.
 * - Given a Session known to be on this server, a machine out of reach holds nothing up.
 * - Given the hub's `machine_no_answer`, the failure is a doubt even when the page thinks every
 *   machine answered, and the machines it names are read from its details.
 */
import { describe, expect, it } from "vitest";
import {
  lookupVerdict,
  routeLookupPending,
  routeReach,
  silentMachinesOf,
} from "../src/features/chat/route-reach";

const NOT_FOUND = { status: 404 };
const NO_ANSWER = { status: 503 };

describe("a failed lookup of the routed Session", () => {
  it("is the verdict that the Session does not exist when every possible holder answered", () => {
    const reach = routeReach({ owner: null, offline: [], asking: [] });
    expect(reach).toBe("answered");
    expect(lookupVerdict(NOT_FOUND, reach)).toBe("missing");
    expect(lookupVerdict(NO_ANSWER, reach)).toBe("failed");
  });

  it("settles nothing while a machine that could hold it is silent, and says that machine is out of reach", () => {
    const reach = routeReach({ owner: null, offline: ["m1"], asking: [] });
    expect(reach).toBe("unanswered");
    expect(lookupVerdict(NOT_FOUND, reach)).toBe("doubt");
    expect(lookupVerdict(NO_ANSWER, reach)).toBe("doubt");
  });

  it("settles nothing, and says nothing yet, while a machine is still being asked", () => {
    const reach = routeReach({ owner: null, offline: ["m2"], asking: ["m1"] });
    expect(reach).toBe("asking");
    expect(lookupVerdict(NOT_FOUND, reach)).toBe("doubt");
  });

  it("counts only the Session's own machine when it is on record", () => {
    expect(routeReach({ owner: "m1", offline: ["m2"], asking: ["m3"] })).toBe("answered");
    expect(routeReach({ owner: "m1", offline: ["m1"], asking: [] })).toBe("unanswered");
    expect(routeReach({ owner: "m1", offline: [], asking: ["m1"] })).toBe("asking");
  });

  it("keeps a lookup that failed in doubt pending after the silent machine answers, until it is made again", () => {
    const base = { listed: false, failed: true, unowned: false };
    expect(routeLookupPending({ ...base, doubted: true })).toBe(true);
    expect(routeLookupPending({ ...base, doubted: false })).toBe(false);
    expect(routeLookupPending({ ...base, unowned: true, doubted: false })).toBe(true);
    expect(routeLookupPending({ ...base, listed: true, doubted: true })).toBe(false);
  });

  it("settles a Session known to be on this server by its own answer, whatever machine is out of reach", () => {
    const reach = routeReach({ owner: null, local: true, offline: ["m-dead"], asking: [] });
    expect(lookupVerdict(NOT_FOUND, reach)).toBe("missing");
  });

  it("takes the hub's machine_no_answer as a doubt, naming the machines its details list", () => {
    const answered = routeReach({ owner: null, offline: [], asking: [] });
    expect(lookupVerdict({ status: 503, code: "machine_no_answer" }, answered)).toBe("doubt");
    expect(silentMachinesOf({ machineId: "m1", alias: "box" })).toEqual(["m1"]);
    expect(silentMachinesOf({ machineId: "m1", machineIds: "m1,m2", aliases: "box, lab" })).toEqual(
      ["m1", "m2"],
    );
  });
});
