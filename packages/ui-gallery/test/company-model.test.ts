/**
 * The company-mode prototype's state keeps the proposal's rules, whatever a reader clicks.
 *
 * - Given a view, what waits is listed in the order it came in and every other view newest first.
 * - Given a ticket, it waits on a person only while proposed, in review, or blocked by a person,
 *   and the inbox lists it in exactly one view: the reader's triage first, then what waits, what
 *   an agent has, and what is settled.
 * - Given the first sentence, the lead answers with proposals only: nothing has a session, no
 *   schedule runs, and the team is the lead and one engineer until a proposed role is accepted;
 *   an empty sentence starts nothing.
 * - Given a proposal, accepting a task starts its work, accepting a schedule switches it on, and
 *   accepting a role adds its byline; rejecting it starts nothing and keeps it on record.
 * - Given time passing, a ticket turns unread only on the step that leaves it waiting on the
 *   person, and that step brings it back from "later".
 * - Given a ticket stopped on its question, time passing does not move it; the answer is written
 *   to the ticket and goes into the same session as the person's message, no second session opens,
 *   and that session carries on to its delivery.
 * - Given a delivery, accepting it closes the ticket and ends its session; sending it back needs a
 *   note, which goes into the session that delivered, and ends in a second delivery there.
 * - Given a work session, the person can talk to it directly: the agent replies in the session
 *   and the words are written to the ticket; an open question still waits; a session that is over,
 *   or an empty message, takes nothing.
 * - Given a session of a ticket, it is live only while it is the ticket's latest and the ticket is
 *   in progress or in review, and it waits when its ticket waits on the person.
 * - Given the handbook, an answer is filed as a decision and a send-back as a lesson, each naming
 *   its ticket; a delivered document is filed only once it is accepted; a skill is filed and
 *   installed for its employee only once it is accepted; progress and talk in a session file
 *   nothing.
 * - Given a budget alert, the answer sets the employee's budget, and carrying it out closes the
 *   ticket with nothing to review.
 * - Given work sent back, or something said in a session, the employee notes it in its own skill
 *   with no approval; accepting a delivery notes nothing.
 * - Given tickets closing, a retrospective comes due once enough have closed since the last one:
 *   it is the whole of that pass, it counts what its window says, files itself in the handbook,
 *   and its proposals wait on the person; a proposal already on the board is not filed twice.
 * - Given a skill accepted, the lesson it came from leaves the index; a change accepted is done
 *   and changes nothing else.
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
  closedSinceRetro,
  metricsOf,
  retroDue,
  windowOf,
  freshState,
  inboxCounts,
  letTimePass,
  liveSessions,
  rejectTicket,
  returnTicket,
  sayInSession,
  sayToLead,
  sessionsOf,
  sessionStatus,
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

/** How many work sessions a ticket has. */
const sessionCount = (state: CompanyState, id: string) => sessionsOf(state, id).length;

/** What a ticket's latest session has said, by who said it. */
const transcript = (state: CompanyState, id: string) =>
  sessionsOf(state, id)
    .at(-1)!
    .messages.map((message) => (message.from === "agent" ? `agent:${message.step}` : message.from));

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
    expect(counts.waiting).toBe(4);
    expect(
      ticketsIn(state, "waiting")
        .map((ticket) => waitOf(ticket))
        .sort(),
    ).toEqual(["accept", "answer", "answer", "review"]);
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
    expect(state.sessions).toEqual([]);
    expect(state.schedules).toEqual([]);
    expect(state.roles).toEqual(["engineer"]);
    expect(letTimePass(state).events).toEqual([]);
  });

  it("starts work, switches a schedule on, or adds a role, by what was accepted", () => {
    let state = startCompany(freshState(), "Look after the repository");
    state = acceptTicket(state, "survey");
    expect(get(state, "survey")).toMatchObject({ status: "in_progress", unread: false });
    expect(transcript(state, "survey")).toEqual(["brief"]);
    state = acceptTicket(state, "patrol");
    expect(get(state, "patrol").status).toBe("done");
    expect(sessionCount(state, "patrol")).toBe(0);
    expect(state.schedules).toEqual([{ id: "patrol", auto: false }]);
    state = acceptTicket(state, "verifier");
    expect(state.roles).toEqual(["engineer", "verifier"]);
  });

  it("keeps a rejected proposal on record with nothing started", () => {
    const state = rejectTicket(startCompany(freshState(), "Look after the repository"), "patrol");
    expect(get(state, "patrol")).toMatchObject({ status: "rejected", unread: false });
    expect(sessionCount(state, "patrol")).toBe(0);
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
    expect(get(state, "csv")).toMatchObject({ asked: true, step: 2, progress: 1 });
    expect(waitOf(get(state, "csv"))).toBe("answer");
    expect(transcript(state, "csv")).toEqual(["brief", "agent:progress", "agent:ask"]);
  });
});

describe("the three things a person does", () => {
  it("records the answer on the ticket and sends it into the session that asked", () => {
    const before = weekState();
    const answered = answerTicket(before, "csv", 1, " keep memory flat ");
    expect(get(answered, "csv")).toMatchObject({
      asked: false,
      answer: 1,
      answerNote: "keep memory flat",
      unread: false,
    });
    expect(waitOf(get(answered, "csv"))).toBeNull();
    expect(sessionCount(answered, "csv")).toBe(1);
    expect(sessionsOf(answered, "csv")[0]!.messages.at(-1)).toEqual({
      from: "person",
      answer: 1,
      note: "keep memory flat",
    });
    expect(answered.chat).toEqual(before.chat);
    const { state, events } = settle(answered);
    expect(events.filter((event) => event.id === "csv").map((event) => event.kind)).toEqual([
      "progress",
      "delivered",
    ]);
    expect(get(state, "csv")).toMatchObject({ status: "review", answer: 1 });
    expect(transcript(state, "csv")).toEqual([
      "brief",
      "agent:progress",
      "agent:ask",
      "person",
      "agent:progress",
      "agent:deliver",
    ]);
  });

  it("closes a delivery the person accepts", () => {
    const state = approveTicket(weekState(), "connection");
    expect(get(state, "connection")).toMatchObject({ status: "done", unread: false });
    expect(inboxViewOf(get(state, "connection"))).toBe("handled");
    expect(sessionStatus(state, sessionsOf(state, "connection")[0]!)).toBe("ended");
  });

  it("sends a delivery back only with a note, into the session that delivers again", () => {
    expect(returnTicket(weekState(), "connection", "  ")).toEqual(weekState());
    const returned = returnTicket(weekState(), "connection", "Name the proxy case too");
    expect(get(returned, "connection")).toMatchObject({
      status: "in_progress",
      delivered: false,
      returns: ["Name the proxy case too"],
    });
    expect(sessionCount(returned, "connection")).toBe(1);
    expect(sessionsOf(returned, "connection")[0]!.messages.at(-1)).toEqual({
      from: "person",
      sendBack: "Name the proxy case too",
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
    for (const id of ["csv", "connection", "flaky", "budget"]) {
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
      unread: false,
    });
    expect(transcript(state, filed.id)).toEqual(["brief"]);
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

describe("talking to a work session directly", () => {
  it("answers in the session and writes the words to the ticket", () => {
    const state = sayInSession(weekState(), "jitter-1", "  Try 1366 wide as well ");
    expect(transcript(state, "jitter")).toEqual([
      "brief",
      "agent:progress",
      "person",
      "agent:noted",
    ]);
    expect(get(state, "jitter").notes).toEqual(["Try 1366 wide as well"]);
    expect(state.chat).toEqual(weekState().chat);
  });

  it("leaves an open question waiting for its answer", () => {
    const state = sayInSession(weekState(), "csv-1", "Which one is faster?");
    expect(waitOf(get(state, "csv"))).toBe("answer");
    expect(sessionStatus(state, sessionsOf(state, "csv")[0]!)).toBe("answer");
  });

  it("takes nothing in a session that is over, or an empty message", () => {
    const state = weekState();
    expect(sessionStatus(state, sessionsOf(state, "docs")[0]!)).toBe("ended");
    expect(sayInSession(state, "docs-1", "One more thing")).toBe(state);
    expect(sayInSession(state, "jitter-1", "   ")).toBe(state);
    expect(sayInSession(state, "nowhere", "Hello")).toBe(state);
  });
});

describe("which sessions are live", () => {
  it("lists the sessions of tickets at work or in review, with what they wait for", () => {
    const state = weekState();
    expect(
      liveSessions(state).map((session) => [session.ticket, sessionStatus(state, session)]),
    ).toEqual([
      ["jitter", "running"],
      ["connection", "review"],
      ["csv", "answer"],
      ["budget", "answer"],
    ]);
  });
});

describe("the handbook", () => {
  const filedFor = (state: CompanyState, id: string) =>
    state.handbook.filter((entry) => entry.ticket === id).map((entry) => entry.kind);

  it("files an answer as a decision that names its ticket", () => {
    const state = answerTicket(weekState(), "csv", 0, "keep memory flat");
    expect(state.handbook.at(-1)).toEqual({
      path: "decisions/csv.md",
      kind: "decision",
      ticket: "csv",
      doc: null,
    });
  });

  it("files a send-back as a lesson that names its ticket and note", () => {
    const state = returnTicket(weekState(), "connection", "Name the proxy case too");
    expect(state.handbook.at(-1)).toMatchObject({
      kind: "lesson",
      ticket: "connection",
      returnIndex: 0,
    });
  });

  it("files a delivered document only once it is accepted", () => {
    let state = acceptTicket(startCompany(freshState(), "Look after the repository"), "survey");
    state = settle(state).state;
    expect(get(state, "survey").status).toBe("review");
    expect(filedFor(state, "survey")).toEqual([]);
    state = approveTicket(state, "survey");
    expect(filedFor(state, "survey")).toEqual(["doc"]);
  });

  it("installs a skill for its employee only once it is accepted", () => {
    const week = weekState();
    const proposed: CompanyState = {
      ...week,
      tickets: week.tickets.map((ticket) =>
        ticket.id === "skill" ? { ...ticket, status: "proposed" } : ticket,
      ),
      handbook: week.handbook
        .filter((entry) => entry.ticket !== "skill")
        .map(({ mergedInto: _merged, ...entry }) => entry),
      closed: week.closed.filter((id) => id !== "skill"),
    };
    expect(filedFor(rejectTicket(proposed, "skill"), "skill")).toEqual([]);
    const accepted = acceptTicket(proposed, "skill");
    expect(get(accepted, "skill").status).toBe("done");
    expect(accepted.handbook.at(-1)).toMatchObject({ kind: "skill", installedOn: "engineer" });
    expect(accepted.handbook.find((entry) => entry.ticket === "docs")?.mergedInto).toBe(
      accepted.handbook.at(-1)!.path,
    );
    expect(accepted.closed.at(-1)).toBe("skill");
  });

  it("files nothing for progress or for talk in a session", () => {
    const week = weekState();
    const talked = sayInSession(week, "jitter-1", "Try 1366 wide as well");
    expect(talked.handbook).toEqual(week.handbook);
    const passed = letTimePass(week).state;
    expect(passed.handbook).toEqual(week.handbook);
  });
});

describe("a budget alert", () => {
  it("raises the budget on the first option and keeps it on the second", () => {
    expect(answerTicket(weekState(), "budget", 0).budgets.engineer).toBe(20);
    expect(answerTicket(weekState(), "budget", 1).budgets.engineer).toBe(12);
  });

  it("closes once carried out, with nothing for the person to review", () => {
    const { state, events } = settle(answerTicket(weekState(), "budget", 0));
    expect(events.filter((event) => event.id === "budget").map((event) => event.kind)).toEqual([
      "closed",
    ]);
    expect(get(state, "budget")).toMatchObject({ status: "done", unread: false });
    expect(transcript(state, "budget")).toEqual(["brief", "agent:ask", "person", "agent:close"]);
  });
});

describe("an employee learning on its own", () => {
  it("notes a send-back and something said in its session, and nothing on an accepted delivery", () => {
    const week = weekState();
    const sentBack = returnTicket(week, "connection", "Name the proxy case too");
    expect(sentBack.learned.at(-1)).toEqual({ byline: "engineer", ticket: "connection" });
    const told = sayInSession(week, "jitter-1", "Try 1366 wide as well");
    expect(told.learned.at(-1)).toEqual({ byline: "verifier", ticket: "jitter" });
    expect(approveTicket(week, "connection").learned).toEqual(week.learned);
  });
});

describe("retrospectives", () => {
  /** The week, with three more tickets closed: enough for the next retrospective. */
  const due = () => {
    let state = approveTicket(weekState(), "connection");
    state = rejectTicket(state, "flaky");
    state = answerTicket(state, "budget", 1);
    while (get(state, "budget").status !== "done") state = letTimePass(state).state;
    return state;
  };

  it("counts what the first one's window says", () => {
    const state = weekState();
    expect(closedSinceRetro(state)).toBe(2);
    expect(metricsOf(state, windowOf(state, state.retros[0]!))).toMatchObject({
      closed: 5,
      accepted: 2,
      firstPass: 1,
      sendBacks: 1,
      questions: 0,
    });
  });

  it("comes due once enough tickets have closed, as the whole of that pass", () => {
    const state = due();
    expect(closedSinceRetro(state)).toBe(5);
    const { state: after, events } = letTimePass(state);
    expect(events).toEqual([{ kind: "retro", id: "2" }]);
    expect(after.sessions).toEqual(state.sessions);
    expect(after.retros.at(-1)).toMatchObject({ n: 2, from: 5, upTo: 10 });
    expect(after.handbook.at(-1)).toMatchObject({ path: "retros/2.md", kind: "retro" });
    expect(get(after, "patrolScope")).toMatchObject({ status: "proposed", source: "retro" });
    expect(closedSinceRetro(after)).toBe(0);
    expect(retroDue(after)).toBe(false);
  });

  it("does not file a proposal that is already on the board", () => {
    const state = due();
    const first = letTimePass(state).state;
    const again = { ...first, retros: first.retros.slice(0, -1) };
    const second = letTimePass(again).state;
    expect(second.tickets.filter((ticket) => ticket.id === "patrolScope")).toHaveLength(1);
    expect(second.retros.at(-1)!.proposals).toEqual([]);
  });

  it("takes a change as written, and closes it", () => {
    const filed = letTimePass(due()).state;
    const accepted = acceptTicket(filed, "patrolScope");
    expect(get(accepted, "patrolScope").status).toBe("done");
    expect(accepted.closed.at(-1)).toBe("patrolScope");
    expect(accepted.schedules).toEqual(filed.schedules);
    expect(accepted.roles).toEqual(filed.roles);
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
    state = approveTicket(approveTicket(state, "csv"), "jitter");
    // The closures bring a retrospective round first; let it run.
    while (retroDue(state)) state = letTimePass(state).state;
    return state;
  };

  it("proposes what it finds, with no session, while it only proposes", () => {
    const { state, events } = letTimePass(quiet());
    expect(events).toEqual([{ kind: "proposed", id: "lint" }]);
    expect(get(state, "lint")).toMatchObject({ status: "proposed", unread: true });
    expect(sessionCount(state, "lint")).toBe(0);
    expect(letTimePass(state).events).toEqual([]);
  });

  it("starts work directly once it is automatic, and reaches the person at the delivery", () => {
    const { state, events } = letTimePass(setScheduleAuto(quiet(), "patrol", true));
    expect(events).toEqual([{ kind: "started", id: "lint" }]);
    expect(get(state, "lint")).toMatchObject({ status: "in_progress", unread: false });
    expect(sessionCount(state, "lint")).toBe(1);
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
      "budget",
    ]);
    expect(ticketsIn(state, "handled").map((ticket) => ticket.id)).toEqual([
      "skill",
      "docs",
      "types",
      "survey",
      "verifier",
      "patrol",
    ]);
  });
});
