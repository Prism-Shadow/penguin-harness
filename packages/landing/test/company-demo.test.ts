/**
 * The day the /company page replays, and the ticket life its chart draws, keep the spec's rules.
 * They are scripted by hand, so this is what stops an edit from putting an inbox on the page that
 * the spec would refuse.
 *
 * - Given a ticket, it waits on a person only while proposed, in review, or blocked by a person;
 *   a ticket blocked by an agent or by another ticket does not.
 * - Given an inbox, what waits on the reader comes first, then what is unread, then the rest, each
 *   group in the order its tickets came in.
 * - Given the three runs, each starts from the inbox the run before it left.
 * - Given any run, a ticket turns unread only on an event that leaves it waiting on the person,
 *   that event is never the person's own, and the person's next step on the ticket reads it.
 * - Given the whole day, its events reach the person four times: the two proposals, the one
 *   question and the one delivery.
 * - Given a ticket a schedule proposed, no work session opens on it before a person accepts it;
 *   a ticket the person asked for starts in progress and waits on nobody.
 * - Given a ticket with its question open, no session works on it until the person answers, and
 *   the answer is on record when work resumes.
 * - Given a delivered ticket, it is done only by a person's step from review.
 * - Given the ticket file, the directory in its path is its status, and it shows the open question
 *   only while the question is open.
 * - Given the charted life, its stretches tile it from filing to done, every work session lies
 *   inside a stretch the agent has, and it ends waiting on the person.
 */
import { describe, expect, it } from "vitest";
import {
  DEMO_PERSON,
  foldInbox,
  initialInbox,
  LIFE,
  SCENARIOS,
  ticketFileLines,
  ticketPath,
} from "../src/lib/company-demo";
import type { DemoStep, DemoTicket, TicketId } from "../src/lib/company-demo";
import { inboxOrder, waitOf } from "../src/lib/company-spec";

const RUNS = SCENARIOS.map((scenario, run) => ({
  run,
  id: scenario.id,
  steps: scenario.steps as readonly DemoStep[],
}));
const ALL_STEPS = RUNS.flatMap(({ run, steps }) => steps.map((step, i) => ({ run, i, step })));

/** A ticket before and after one step of a run. */
function around(run: number, i: number, id: TicketId) {
  const find = (count: number) =>
    foldInbox(run, count).tickets.find((candidate) => candidate.id === id);
  return { before: find(i), after: find(i + 1) };
}

/** A ticket at the end of the day. */
const finalTicket = (id: TicketId): DemoTicket =>
  foldInbox(SCENARIOS.length - 1, SCENARIOS.at(-1)!.steps.length).tickets.find(
    (candidate) => candidate.id === id,
  )!;

describe("the waiting rule", () => {
  it("names the three reasons a ticket waits on a person", () => {
    expect(waitOf({ status: "proposed" })).toBe("accept");
    expect(waitOf({ status: "in_progress", blockedBy: "user:alice" })).toBe("answer");
    expect(waitOf({ status: "review" })).toBe("review");
  });

  it("does not count a ticket an agent or another ticket blocks, or a settled one", () => {
    expect(waitOf({ status: "in_progress" })).toBeNull();
    expect(waitOf({ status: "in_progress", blockedBy: "agent:lead" })).toBeNull();
    expect(waitOf({ status: "in_progress", blockedBy: "2026-11-13-export-csv" })).toBeNull();
    expect(waitOf({ status: "done", blockedBy: "user:alice" })).toBeNull();
    expect(waitOf({ status: "rejected" })).toBeNull();
  });
});

describe("the inbox order", () => {
  it("puts what waits first, then what is unread, then the rest, each in arrival order", () => {
    const tickets = [
      { id: "settled", status: "done", unread: false },
      { id: "unread-result", status: "done", unread: true },
      { id: "to-review", status: "review", unread: false },
      { id: "working", status: "in_progress", unread: false },
      { id: "to-accept", status: "proposed", unread: true },
    ] as const;
    expect(inboxOrder(tickets).map((ticket) => ticket.id)).toEqual([
      "to-review",
      "to-accept",
      "unread-result",
      "settled",
      "working",
    ]);
  });
});

describe("the replayed day", () => {
  it("starts each run from the inbox the run before it left", () => {
    expect(initialInbox(0)).toEqual([]);
    for (const { run, steps } of RUNS.slice(0, -1)) {
      expect(initialInbox(run + 1)).toEqual(foldInbox(run, steps.length).tickets);
    }
  });

  it("marks a ticket unread only when an event leaves it waiting, and never on the person's own step", () => {
    for (const { run, i, step } of ALL_STEPS) {
      if (step.ticket === undefined) continue;
      const { before, after } = around(run, i, step.ticket);
      const event = foldInbox(run, i + 1).events[i]!;
      const turnedUnread = after!.unread && before?.unread !== true;
      expect(turnedUnread, step.id).toBe(event.reaches !== null);
      if (event.reaches !== null) expect(step.actor, step.id).not.toBe("person");
      if (step.actor === "person") expect(after!.unread, step.id).toBe(false);
    }
  });

  it("reaches the person four times in the day: two proposals, one question, one delivery", () => {
    const reached = RUNS.flatMap(({ run, steps }) =>
      foldInbox(run, steps.length).events.map((event) => event.reaches),
    ).filter((reason) => reason !== null);
    expect(reached).toEqual(["accept", "accept", "answer", "review"]);
  });

  it("opens no session on a schedule's proposal before a person accepts it", () => {
    const { steps } = RUNS[0]!;
    const accepted = steps.findIndex((step) => step.id === "accept_flaky");
    for (let count = 0; count <= accepted; count++) {
      const proposal = foldInbox(0, count).tickets.find((t) => t.id === "flaky_export");
      expect(proposal?.sessions ?? []).toEqual([]);
    }
    expect(steps[accepted]!.actor).toBe("person");
    expect(
      foldInbox(0, steps.length).tickets.find((t) => t.id === "flaky_export")!.sessions,
    ).toEqual(["s_f1"]);
    expect(foldInbox(0, steps.length).tickets.find((t) => t.id === "bump_types")!.sessions).toEqual(
      [],
    );
  });

  it("starts a ticket the person asked for in progress, waiting on nobody", () => {
    const filed = foldInbox(1, 2).tickets.find((t) => t.id === "export_csv")!;
    expect(filed.source).toBe(DEMO_PERSON);
    expect(filed.status).toBe("in_progress");
    expect(waitOf(filed)).toBeNull();
    expect(filed.unread).toBe(false);
  });

  it("stops work on an open question until the person answers, with the answer on record", () => {
    const { steps } = RUNS[1]!;
    const asked = steps.findIndex((step) => step.id === "ask_stream");
    const answered = steps.findIndex((step) => step.id === "answer_stream");
    expect(waitOf(around(1, asked, "export_csv").after!)).toBe("answer");
    expect(steps.slice(asked + 1, answered).filter((step) => step.ticket === "export_csv")).toEqual(
      [],
    );
    expect(steps[answered]!.actor).toBe("person");
    const resumed = around(1, answered, "export_csv").after!;
    expect(resumed).toMatchObject({ ask: false, decided: true });
    expect(waitOf(resumed)).toBeNull();
    expect(steps.slice(answered + 1).map((step) => step.actor)).toEqual(["server"]);
  });

  it("closes a delivered ticket only by a person's step from review", () => {
    for (const { run, i, step } of ALL_STEPS) {
      if (step.ticket === undefined) continue;
      const { before, after } = around(run, i, step.ticket);
      if (after!.status !== "done" || before?.status === "done") continue;
      expect(before?.status, step.id).toBe("review");
      expect(step.actor, step.id).toBe("person");
    }
    expect(finalTicket("export_csv")).toMatchObject({ status: "done", deliverables: ["pull/128"] });
  });
});

describe("the ticket file", () => {
  const words = {
    title: "CSV export",
    progress: ["first", "second"],
    question: "Stream or build?",
    options: ["stream", "build"],
    decision: "Stream.",
  };
  const csvAfter = (id: string) => {
    const index = RUNS[1]!.steps.findIndex((step) => step.id === id);
    return around(1, index, "export_csv").after!;
  };

  it("keeps the ticket's status as the directory in its path", () => {
    expect(ticketPath(csvAfter("file_csv"))).toBe(
      "tickets/2026-11/in_progress/2026-11-13-export-csv.md",
    );
    expect(ticketPath(finalTicket("export_csv"))).toBe(
      "tickets/2026-11/done/2026-11-13-export-csv.md",
    );
  });

  it("shows the question only while it is open, then the answer under Decisions", () => {
    const open = ticketFileLines(csvAfter("ask_stream"), words);
    expect(open).toContain("blocked_by: user:alice");
    expect(open).toContain("  question: Stream or build?");
    expect(open).not.toContain("## Decisions");

    const answered = ticketFileLines(csvAfter("answer_stream"), words);
    expect(answered.some((line) => line.startsWith("blocked_by") || line === "ask:")).toBe(false);
    expect(answered.slice(-2)).toEqual(["## Decisions", "- Stream."]);
  });
});

describe("the charted life", () => {
  it("tiles the ticket's life from filing to done and ends waiting on the person", () => {
    expect(LIFE.phases[0]!.begin).toBe(0);
    expect(LIFE.phases.at(-1)!.end).toBe(LIFE.total);
    LIFE.phases.slice(1).forEach((phase, i) => expect(phase.begin).toBe(LIFE.phases[i]!.end));
    for (const phase of LIFE.phases) {
      expect(
        waitOf({ status: phase.status, blockedBy: phase.wait === "answer" ? "user:a" : undefined }),
      ).toBe(phase.wait);
    }
    expect(LIFE.phases.at(-1)!.wait).toBe("review");
  });

  it("runs every work session inside a stretch the agent has", () => {
    const agentHas = LIFE.phases.filter((phase) => phase.wait === null);
    for (const session of LIFE.sessions) {
      expect(
        agentHas.some((phase) => phase.begin <= session.begin && session.end <= phase.end),
      ).toBe(true);
    }
  });
});
