/**
 * The company-mode prototype's state keeps the proposal's rules, whatever a reader clicks.
 *
 * - Given a view, what waits is listed in the order it came in and every other view newest first.
 * - Given a ticket, it waits on a person only while proposed, in review, or blocked by a person,
 *   and the inbox lists it in exactly one view: the reader's triage first, then what waits, what
 *   an agent has, and what is settled.
 * - Given the first sentence, the lead answers with proposals only: nothing has a session, no
 *   schedule runs and no role has joined until each is accepted; an empty sentence starts nothing.
 * - Given a proposal, accepting a task starts its work, accepting a schedule switches it on, and
 *   accepting a role adds its byline; rejecting it starts nothing and keeps it on record.
 * - Given time passing, a ticket turns unread only on the step that leaves it waiting on the
 *   person, and that step brings it back from "later".
 * - Given a ticket stopped on its question, time passing does not move it; the answer is on the
 *   ticket when work resumes in a new session, and the lead says it recorded the decision.
 * - Given a delivery, accepting it closes the ticket; sending it back needs a note, opens a new
 *   session and ends in a second delivery.
 * - Given an action the ticket does not wait for, nothing changes.
 * - Given a ticket that waits on the person, it cannot be snoozed or archived; one that does not
 *   can, and restoring it puts it back where its work is.
 * - Given something said to the lead, a ticket is filed already in progress, read, with the
 *   person's words as its title.
 * - Given a schedule that only proposes, its find waits for the person with no session; switched
 *   to automatic, its find starts work directly and reaches the person only at its delivery.
 */
import { describe, expect, it } from "vitest";
import {
  acceptTicket,
  answerTicket,
  approveTicket,
  freshState,
  inboxCounts,
  letTimePass,
  rejectTicket,
  returnTicket,
  sayToLead,
  setScheduleAuto,
  startCompany,
  ticketsIn,
  triageTicket,
  weekState,
} from "../src/company/model";
import type { CompanyState, Ticket } from "../src/company/model";
import { inboxViewOf, waitOf } from "../src/company/spec";

const get = (state: CompanyState, id: string): Ticket =>
  state.tickets.find((ticket) => ticket.id === id)!;

/** Let time pass until nothing moves, collecting what happened. */
function settle(state: CompanyState) {
  const events = [];
  for (let i = 0; i < 40; i++) {
    const passed = letTimePass(state);
    if (passed.events.length === 0) break;
    state = passed.state;
    events.push(...passed.events);
  }
  return { state, events };
}

describe("the waiting rule and the inbox views", () => {
  it("names the three reasons a ticket waits on a person, and no others", () => {
    expect(waitOf({ status: "proposed" })).toBe("accept");
    expect(waitOf({ status: "in_progress", blockedBy: "user:you" })).toBe("answer");
    expect(waitOf({ status: "review" })).toBe("review");
    expect(waitOf({ status: "in_progress" })).toBeNull();
    expect(waitOf({ status: "in_progress", blockedBy: "agent:lead" })).toBeNull();
    expect(waitOf({ status: "done", blockedBy: "user:you" })).toBeNull();
    expect(waitOf({ status: "rejected" })).toBeNull();
  });

  it("lists a ticket in one view, the reader's triage first", () => {
    const at = (status: Ticket["status"], triage = {}) =>
      inboxViewOf({ status, snoozed: false, archived: false, ...triage });
    expect(at("review")).toBe("waiting");
    expect(at("in_progress")).toBe("working");
    expect(at("done")).toBe("handled");
    expect(at("rejected")).toBe("handled");
    expect(at("in_progress", { snoozed: true })).toBe("later");
    expect(at("done", { archived: true, snoozed: true })).toBe("archived");
  });

  it("counts every ticket of the sample week once", () => {
    const state = weekState();
    const counts = inboxCounts(state);
    expect(Object.values(counts).reduce((a, b) => a + b)).toBe(state.tickets.length);
    expect(counts.waiting).toBe(3);
    expect(
      ticketsIn(state, "waiting")
        .map((ticket) => waitOf(ticket))
        .sort(),
    ).toEqual(["accept", "answer", "review"]);
  });
});

describe("setting a company up", () => {
  it("starts nothing on an empty sentence", () => {
    expect(startCompany(freshState(), "   ")).toEqual(freshState());
  });

  it("answers the first sentence with proposals and nothing running", () => {
    const state = startCompany(freshState(), "Look after the repository");
    expect(state.stage).toBe("running");
    expect(state.mission).toBe("Look after the repository");
    expect(state.tickets.map((ticket) => ticket.kind)).toEqual(["schedule", "task", "role"]);
    expect(state.tickets.every((ticket) => waitOf(ticket) === "accept" && ticket.unread)).toBe(
      true,
    );
    expect(state.tickets.every((ticket) => ticket.sessions === 0)).toBe(true);
    expect(state.schedules).toEqual([]);
    expect(state.roles).toEqual([]);
    expect(letTimePass(state).events).toEqual([]);
  });

  it("starts work, switches a schedule on, or adds a role, by what was accepted", () => {
    let state = startCompany(freshState(), "Look after the repository");
    state = acceptTicket(state, "survey");
    expect(get(state, "survey")).toMatchObject({
      status: "in_progress",
      sessions: 1,
      unread: false,
    });
    state = acceptTicket(state, "patrol");
    expect(get(state, "patrol").status).toBe("done");
    expect(state.schedules).toEqual([{ id: "patrol", auto: false }]);
    state = acceptTicket(state, "verifier");
    expect(state.roles).toEqual(["verifier"]);
  });

  it("keeps a rejected proposal on record with nothing started", () => {
    const state = rejectTicket(startCompany(freshState(), "Look after the repository"), "patrol");
    expect(get(state, "patrol")).toMatchObject({ status: "rejected", sessions: 0, unread: false });
    expect(state.schedules).toEqual([]);
    expect(inboxViewOf(get(state, "patrol"))).toBe("handled");
  });
});

describe("time passing", () => {
  it("marks a ticket unread only on the step that leaves it waiting, and brings it back from later", () => {
    let state = triageTicket(weekState(), "jitter", "snooze");
    expect(inboxViewOf(get(state, "jitter"))).toBe("later");
    for (let i = 0; i < 6; i++) {
      const before = get(state, "jitter");
      const passed = letTimePass(state);
      const after = get(passed.state, "jitter");
      const startedWaiting = waitOf(after) !== null && waitOf(before) === null;
      expect(after.unread && !before.unread).toBe(startedWaiting);
      if (startedWaiting) expect(after.snoozed).toBe(false);
      state = passed.state;
    }
    expect(get(state, "jitter")).toMatchObject({ status: "review", delivered: true, progress: 2 });
    expect(inboxViewOf(get(state, "jitter"))).toBe("waiting");
  });

  it("does not move a ticket that is stopped on its question", () => {
    const { state } = settle(weekState());
    expect(get(state, "csv")).toMatchObject({ asked: true, step: 2, progress: 1, sessions: 1 });
    expect(waitOf(get(state, "csv"))).toBe("answer");
  });
});

describe("the three things a person does", () => {
  it("records the answer, then resumes in a new session, and the lead says so", () => {
    const answered = answerTicket(weekState(), "csv", 1, " keep memory flat ");
    expect(get(answered, "csv")).toMatchObject({
      asked: false,
      answer: 1,
      answerNote: "keep memory flat",
      sessions: 2,
      unread: false,
    });
    expect(waitOf(get(answered, "csv"))).toBeNull();
    expect(answered.chat.at(-1)).toEqual({ from: "lead", line: "recorded", tickets: ["csv"] });
    const { state, events } = settle(answered);
    expect(events.filter((event) => event.id === "csv").map((event) => event.kind)).toEqual([
      "progress",
      "delivered",
    ]);
    expect(get(state, "csv")).toMatchObject({ status: "review", answer: 1 });
  });

  it("closes a delivery the person accepts", () => {
    const state = approveTicket(weekState(), "connection");
    expect(get(state, "connection")).toMatchObject({ status: "done", unread: false });
    expect(inboxViewOf(get(state, "connection"))).toBe("handled");
  });

  it("sends a delivery back only with a note, to a new session that delivers again", () => {
    expect(returnTicket(weekState(), "connection", "  ")).toEqual(weekState());
    const returned = returnTicket(weekState(), "connection", "Name the proxy case too");
    expect(get(returned, "connection")).toMatchObject({
      status: "in_progress",
      delivered: false,
      returns: ["Name the proxy case too"],
      sessions: 2,
    });
    const { state } = settle(returned);
    expect(get(state, "connection")).toMatchObject({
      status: "review",
      delivered: true,
      unread: true,
    });
  });

  it("ignores an action the ticket does not wait for", () => {
    const state = weekState();
    expect(acceptTicket(state, "csv")).toBe(state);
    expect(rejectTicket(state, "connection")).toBe(state);
    expect(answerTicket(state, "flaky", 0)).toBe(state);
    expect(approveTicket(state, "jitter")).toBe(state);
    expect(returnTicket(state, "csv", "no")).toBe(state);
    expect(acceptTicket(state, "nowhere")).toBe(state);
  });
});

describe("triage", () => {
  it("refuses to snooze or archive a ticket that waits on the person", () => {
    const state = weekState();
    for (const id of ["csv", "connection", "flaky"]) {
      expect(triageTicket(state, id, "snooze")).toBe(state);
      expect(triageTicket(state, id, "archive")).toBe(state);
    }
  });

  it("moves a quiet ticket between views without touching its work", () => {
    const state = weekState();
    const archived = triageTicket(state, "docs", "archive");
    expect(inboxViewOf(get(archived, "docs"))).toBe("archived");
    expect(get(archived, "docs").status).toBe("done");
    const restored = triageTicket(archived, "docs", "restore");
    expect(get(restored, "docs")).toEqual(get(state, "docs"));
    expect(triageTicket(state, "docs", "restore")).toBe(state);
  });
});

describe("talking to the lead", () => {
  it("files what the person says as a ticket in progress, read, in their words", () => {
    const state = sayToLead(weekState(), "  Add a dark-mode screenshot to the README ");
    const filed = state.tickets.at(-1)!;
    expect(filed).toMatchObject({
      title: "Add a dark-mode screenshot to the README",
      source: "person",
      status: "in_progress",
      sessions: 1,
      unread: false,
    });
    expect(state.chat.slice(-2)).toEqual([
      { from: "person", text: "Add a dark-mode screenshot to the README" },
      { from: "lead", line: "filed", tickets: [filed.id] },
    ]);
    expect(get(settle(state).state, filed.id).status).toBe("review");
  });

  it("files nothing for an empty message, or before the company is set up", () => {
    expect(sayToLead(weekState(), " ")).toEqual(weekState());
    expect(sayToLead(freshState(), "Fix it")).toEqual(freshState());
  });
});

describe("a patrol", () => {
  const quiet = () => {
    // Settle everything the sample week has open, so the next thing to happen is a patrol.
    let state = approveTicket(weekState(), "connection");
    state = rejectTicket(state, "flaky");
    state = answerTicket(state, "csv", 0);
    // Only until both deliveries are in: one more pass would be the patrol itself.
    while (get(state, "csv").status !== "review" || get(state, "jitter").status !== "review") {
      state = letTimePass(state).state;
    }
    return approveTicket(approveTicket(state, "csv"), "jitter");
  };

  it("proposes what it finds, with no session, while it only proposes", () => {
    const { state, events } = letTimePass(quiet());
    expect(events).toEqual([{ kind: "proposed", id: "lint" }]);
    expect(get(state, "lint")).toMatchObject({ status: "proposed", sessions: 0, unread: true });
    expect(letTimePass(state).events).toEqual([]);
  });

  it("starts work directly once it is automatic, and reaches the person at the delivery", () => {
    const { state, events } = letTimePass(setScheduleAuto(quiet(), "patrol", true));
    expect(events).toEqual([{ kind: "started", id: "lint" }]);
    expect(get(state, "lint")).toMatchObject({ status: "in_progress", sessions: 1, unread: false });
    const done = settle(state);
    expect(done.events.map((event) => event.kind)).toEqual(["progress", "delivered"]);
    expect(get(done.state, "lint")).toMatchObject({ status: "review", unread: true });
  });
});

describe("the order of a view", () => {
  it("lists what waits in the order it came in, and every other view newest first", () => {
    const state = weekState();
    expect(ticketsIn(state, "waiting").map((ticket) => ticket.id)).toEqual([
      "connection",
      "csv",
      "flaky",
    ]);
    expect(ticketsIn(state, "handled").map((ticket) => ticket.id)).toEqual([
      "docs",
      "types",
      "survey",
      "verifier",
      "patrol",
    ]);
  });
});
