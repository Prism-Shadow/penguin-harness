/**
 * The company app draft's ticket flow.
 *
 * - Given a ticket waiting on a decision, when the user picks an answer, then it goes back to
 *   work and the handbook gains a rule naming the answer; no other ticket moves.
 * - Given a verified delivery, when the user accepts it, then it settles; accepting a ticket
 *   that is not waiting for acceptance changes nothing.
 * - Given a verified delivery, when the user sends it back without a reason, nothing changes;
 *   with a reason, the round is counted, the lesson lands in the handbook naming the Skill
 *   version it produced, the executor's Skill moves one version and the ticket goes back to work.
 * - Given a delivery on its last allowed round, when the user sends it back, then the ticket
 *   halts with a send-back breaker in the inbox instead of going back to work.
 * - Given a halted ticket, when the user lifts the breaker, then a rounds breaker grants exactly
 *   one more round and a budget breaker adds the budget step.
 * - Given an open ticket, when the user stops it, then it settles with nothing delivered; a
 *   settled ticket cannot be stopped again.
 * - Rolling a Skill back never goes below its first version.
 * - The app's location: an unknown path opens the inbox, and an open ticket round-trips.
 */
import { describe, expect, it } from "vitest";
import { demoNotes, demoOrgs } from "../src/company/fixtures";
import { atOf, placeOf } from "../src/company/frame";
import {
  accept,
  BUDGET_STEP,
  decide,
  memberById,
  resume,
  rollBack,
  sendBack,
  stop,
  ticketById,
  waitingOnYou,
} from "../src/company/model";
import type { Org, Ticket } from "../src/company/model";

const notes = demoNotes("en");
const org = (): Org => demoOrgs("en")[0]!;
const ticket = (o: Org, id: string): Ticket => ticketById(o, id)!;

describe("the company app's ticket flow", () => {
  it("returns a decided ticket to work and writes the answer into the handbook", () => {
    const before = org();
    const after = decide(before, "T-14", "Both", notes);
    expect(ticket(after, "T-14").stage).toBe("working");
    expect(ticket(after, "T-14").need).toBeUndefined();
    expect(after.handbook.at(-1)).toMatchObject({ kind: "rule", ticket: "T-14" });
    expect(after.handbook.at(-1)?.text).toContain("Both");
    expect(after.tickets.filter((t) => t.id !== "T-14")).toEqual(
      before.tickets.filter((t) => t.id !== "T-14"),
    );
  });

  it("settles an accepted delivery, and accepts nothing that is not waiting for it", () => {
    const after = accept(org(), "T-12", notes);
    expect(ticket(after, "T-12").stage).toBe("done");
    expect(waitingOnYou(after).map((t) => t.id)).not.toContain("T-12");
    const untouched = org();
    expect(accept(untouched, "T-14", notes)).toBe(untouched);
  });

  it("ignores a send-back without a reason", () => {
    const before = org();
    expect(sendBack(before, "T-12", "   ", notes)).toBe(before);
  });

  it("counts a send-back, records the lesson and moves the executor's Skill", () => {
    const before = org();
    const writer = memberById(before, "writer")!;
    const after = sendBack(before, "T-12", "The table is cut off", notes);
    expect(ticket(after, "T-12")).toMatchObject({ stage: "working", rounds: 2 });
    expect(ticket(after, "T-12").need).toBeUndefined();
    expect(after.handbook.at(-1)).toMatchObject({
      kind: "lesson",
      text: "The table is cut off",
      member: "writer",
      version: writer.skillVersion + 1,
    });
    expect(memberById(after, "writer")?.skillVersion).toBe(writer.skillVersion + 1);
  });

  it("halts a delivery sent back on its last round instead of returning it to work", () => {
    const before = org();
    const once = sendBack(before, "T-12", "First", notes);
    const lastRound = {
      ...once,
      tickets: once.tickets.map((t) =>
        t.id === "T-12" ? { ...t, stage: "yours" as const, need: ticket(before, "T-12").need! } : t,
      ),
    };
    const after = sendBack(lastRound, "T-12", "Second", notes);
    expect(ticket(after, "T-12")).toMatchObject({ stage: "halted", rounds: 3 });
    expect(ticket(after, "T-12").need).toMatchObject({ kind: "breaker", reason: "rounds" });
    expect(waitingOnYou(after).map((t) => t.id)).toContain("T-12");
  });

  it("grants one more round for a rounds breaker and more budget for a budget breaker", () => {
    const rounds = resume(org(), "T-11", notes);
    expect(ticket(rounds, "T-11")).toMatchObject({ stage: "working", maxRounds: 4, budget: 2 });
    const spent = org();
    const budgetHalt = {
      ...spent,
      tickets: spent.tickets.map((t) =>
        t.id === "T-11"
          ? { ...t, need: { kind: "breaker" as const, reason: "budget" as const, verdict: "" } }
          : t,
      ),
    };
    const budget = resume(budgetHalt, "T-11", notes);
    expect(ticket(budget, "T-11")).toMatchObject({ maxRounds: 3, budget: 2 + BUDGET_STEP });
  });

  it("settles a stopped ticket with nothing delivered, once", () => {
    const after = stop(org(), "T-11", notes);
    expect(ticket(after, "T-11")).toMatchObject({ stage: "done", outcome: notes.stoppedOutcome });
    expect(ticket(after, "T-11").need).toBeUndefined();
    expect(stop(after, "T-11", notes)).toBe(after);
  });

  it("never rolls a Skill back below its first version", () => {
    let o = org();
    for (let i = 0; i < 10; i++) o = rollBack(o, "checker");
    expect(memberById(o, "checker")?.skillVersion).toBe(1);
  });
});

describe("the company app's location", () => {
  it("opens the inbox for an unknown path and round-trips an open ticket", () => {
    expect(placeOf("/nowhere")).toEqual({ route: "/", ticket: null });
    const place = { route: "/tickets" as const, ticket: "T-12" };
    expect(placeOf(atOf(place))).toEqual(place);
  });
});
