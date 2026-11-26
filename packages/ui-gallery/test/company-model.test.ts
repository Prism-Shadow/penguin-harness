/**
 * The company-mode prototype's model, driven the way the reader's clicks drive it: the state
 * machine and its holders, the inbox's three groups, the server's limits on every step, events
 * that file tickets, calls written back to tickets and the handbook, send-backs that become
 * lessons in a versioned skill, and the lead's review.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, STARTERS } from "../src/company/fixtures";
import {
  acceptWork,
  answerAsk,
  answerHalt,
  answerProposal,
  askLead,
  fileRequest,
  freshState,
  groupCounts,
  letTimePass,
  metricsOf,
  openDraft,
  rollback,
  runReview,
  sendBack,
  setTrigger,
  startCompany,
  suggestions,
  ticketGroup,
  ticketOf,
  ticketWait,
  weekState,
} from "../src/company/model";
import type { CompanyState, Setup } from "../src/company/model";
import { groupOf, HOLDER, TRANSITIONS, waitOf } from "../src/company/spec";

const ticket = (state: CompanyState, id: string) => {
  const found = ticketOf(state, id);
  if (found === undefined) throw new Error(`no ticket ${id}`);
  return found;
};

/** Lets time pass `n` times. */
function pass(state: CompanyState, n = 1): CompanyState {
  let next = state;
  for (let i = 0; i < n; i += 1) next = letTimePass(next).state;
  return next;
}

const SETUP: Setup = {
  scenario: "software",
  work: ["code", "document"],
  budget: 5,
  rounds: 2,
  events: true,
  models: {},
};

describe("the state machine", () => {
  it("binds every move to the hand that holds the status it leaves", () => {
    for (const move of TRANSITIONS) expect(HOLDER[move.from]).toBe(move.by);
  });

  it("waits on the person only for a proposal, a question, a breaker or verified work", () => {
    const base = { asking: false, halted: false };
    expect(waitOf({ ...base, status: "proposed" })).toBe("accept");
    expect(waitOf({ ...base, status: "working" })).toBeNull();
    expect(waitOf({ ...base, status: "verifying" })).toBeNull();
    expect(waitOf({ ...base, status: "working", asking: true })).toBe("ask");
    expect(waitOf({ ...base, status: "verifying", halted: true })).toBe("halt");
    expect(waitOf({ ...base, status: "deciding" })).toBe("decide");
    expect(groupOf({ ...base, status: "working" })).toBe("moving");
    expect(groupOf({ ...base, status: "done" })).toBe("settled");
    expect(groupOf({ ...base, status: "dropped" })).toBe("settled");
  });
});

describe("the sample week", () => {
  const week = weekState();

  it("holds every kind of call in the first group, and nothing else", () => {
    expect(ticketWait(ticket(week, "exportFix"))).toBe("decide");
    expect(ticketWait(ticket(week, "evalSummary"))).toBe("ask");
    expect(ticketWait(ticket(week, "releasePost"))).toBe("decide");
    expect(ticket(week, "resellerTerms").halt).toBe("rounds");
    expect(ticketWait(ticket(week, "replies"))).toBe("decide");
    expect(ticketWait(ticket(week, "lintRule"))).toBe("accept");
    expect(groupCounts(week)).toEqual({ decide: 6, moving: 3, settled: 3 });
  });

  it("only ever brings verified work to the person for acceptance", () => {
    for (const t of week.tickets.filter((candidate) => candidate.status === "deciding")) {
      expect(t.runs.some((run) => run.step === "pass" && run.by === "verifier")).toBe(true);
    }
  });

  it("wrote every send-back down as a lesson and a new skill version", () => {
    const lessons = week.handbook.filter((entry) => entry.kind === "lesson");
    const sendBacks = week.tickets.reduce((sum, t) => sum + t.review.length, 0);
    expect(lessons).toHaveLength(sendBacks);
    // ciCache and exportFix were each sent back once.
    expect(week.skills.dev.versions.map((version) => version.v)).toEqual([1, 2, 3]);
    expect(week.skills.dev.current).toBe(3);
  });

  it("opens with nothing tried yet", () => {
    expect(week.did).toEqual([]);
  });
});

describe("letting time pass", () => {
  it("sends failed work back on its own, then brings the verified work to the person", () => {
    let state = weekState();
    state = pass(state);
    expect(ticket(state, "syncDup").status).toBe("verifying");
    const returned = letTimePass(state);
    expect(returned.events).toContainEqual({ kind: "returned", id: "syncDup" });
    state = returned.state;
    expect(ticket(state, "syncDup").status).toBe("working");
    expect(ticket(state, "syncDup").rounds.used).toBe(1);
    expect(state.did).toContain("autoReturn");
    state = pass(state, 3);
    expect(ticketWait(ticket(state, "syncDup"))).toBe("decide");
  });

  it("stops work at its budget before the step that would cross it", () => {
    const state = pass(weekState(), 2);
    const invoices = ticket(state, "invoices");
    expect(invoices.halt).toBe("budget");
    expect(invoices.spent).toBeLessThanOrEqual(invoices.budget);
    expect(ticketGroup(invoices)).toBe("decide");
  });

  it("files a ticket for an event as it arrives, unless its trigger is off", () => {
    const on = letTimePass(weekState());
    expect(on.events).toContainEqual({ kind: "arrived", id: "installWin" });
    expect(ticket(on.state, "installWin").source).toBe("github");
    expect(on.state.did).toContain("event");
    const off = letTimePass(setTrigger(weekState(), "github", false));
    expect(ticketOf(off.state, "installWin")).toBeUndefined();
    const later = pass(weekState(), 3);
    expect(ticket(later, "proInquiry").outward).toBe("email");
  });

  it("moves nothing that waits on the person", () => {
    const state = pass(weekState(), 12);
    expect(ticket(state, "evalSummary").at).toBe(ticket(weekState(), "evalSummary").at);
    expect(ticket(state, "lintRule").status).toBe("proposed");
  });
});

describe("the server's limits", () => {
  it("never lets the verifier send work back past the round limit", () => {
    let state = weekState();
    for (let i = 0; i < 20; i += 1) {
      state = pass(state);
      for (const t of state.tickets) expect(t.rounds.used).toBeLessThanOrEqual(t.rounds.limit);
    }
  });

  it("goes on with a raised limit, or brings the work to the person, or stops", () => {
    const week = weekState();
    const more = answerHalt(week, "resellerTerms", "more");
    expect(ticket(more, "resellerTerms").rounds.limit).toBe(3);
    expect(ticket(pass(more, 4), "resellerTerms").status).toBe("deciding");
    const decide = answerHalt(week, "resellerTerms", "decide");
    expect(ticket(decide, "resellerTerms").status).toBe("deciding");
    const stop = answerHalt(week, "resellerTerms", "stop");
    expect(ticket(stop, "resellerTerms").status).toBe("dropped");
    expect(stop.did).toContain("halt");
  });

  it("doubles a budget that ran out, and the work goes on", () => {
    const halted = pass(weekState(), 2);
    const more = answerHalt(halted, "invoices", "more");
    expect(ticket(more, "invoices").budget).toBe(4);
    expect(ticketWait(ticket(pass(more, 3), "invoices"))).toBe("decide");
  });
});

describe("the reader's calls", () => {
  it("writes an answer back to the ticket and, when asked, to the handbook", () => {
    const answered = answerAsk(weekState(), "evalSummary", "subset", "长文档优先", true);
    const t = ticket(answered, "evalSummary");
    expect(t.asking).toBe(false);
    expect(t.decisions.at(-1)).toEqual({
      kind: "ask",
      option: "subset",
      note: "长文档优先",
      filed: true,
    });
    expect(answered.handbook.at(-1)).toMatchObject({ kind: "decision", ticket: "evalSummary" });
    const quiet = answerAsk(weekState(), "evalSummary", "subset", "", false);
    expect(quiet.handbook).toHaveLength(weekState().handbook.length);
  });

  it("gives a large experiment the budget it needs, and drops a stopped one", () => {
    expect(
      ticket(answerAsk(weekState(), "evalSummary", "full", "", false), "evalSummary").budget,
    ).toBe(24);
    expect(
      ticket(answerAsk(weekState(), "evalSummary", "stop", "", false), "evalSummary").status,
    ).toBe("dropped");
  });

  it("accepts only verified work, approving its outward action", () => {
    const week = weekState();
    expect(acceptWork(week, "syncDup")).toBe(week);
    const merged = acceptWork(week, "exportFix");
    expect(ticket(merged, "exportFix").status).toBe("done");
    expect(ticket(merged, "exportFix").decisions.at(-1)).toEqual({
      kind: "accept",
      outward: "merge",
    });
    expect(merged.did).toEqual(expect.arrayContaining(["accept", "outward"]));
  });

  it("opens a draft once, for the reader to send", () => {
    const opened = openDraft(openDraft(weekState(), "replies", 1), "replies", 1);
    expect(ticket(opened, "replies").opened).toEqual([1]);
  });

  it("sends work back with a note that becomes the executor's lesson", () => {
    const week = weekState();
    const back = sendBack(week, "releasePost", "第 3 段太长", 2);
    const t = ticket(back, "releasePost");
    expect(t.status).toBe("working");
    expect(t.review.at(-1)).toMatchObject({ by: "person", paragraph: 2, version: 2 });
    expect(back.skills.ops.versions).toHaveLength(week.skills.ops.versions.length + 1);
    expect(ticketWait(ticket(pass(back, 3), "releasePost"))).toBe("decide");
    expect(sendBack(week, "releasePost", "  ")).toBe(week);
  });
});

describe("how the company gets better", () => {
  it("applies an accepted proposal to the member's skill", () => {
    const week = weekState();
    const accepted = answerProposal(week, "lintRule", true);
    expect(ticket(accepted, "lintRule").status).toBe("done");
    expect(accepted.skills.dev.versions).toHaveLength(week.skills.dev.versions.length + 1);
    expect(accepted.handbook.at(-1)).toMatchObject({ kind: "change", ticket: "lintRule" });
    const declined = answerProposal(week, "lintRule", false);
    expect(ticket(declined, "lintRule").status).toBe("dropped");
    expect(declined.skills.dev).toBe(week.skills.dev);
  });

  it("rolls a skill back and forward without losing a version", () => {
    const week = weekState();
    const back = rollback(week, "dev", 1);
    expect(back.skills.dev.current).toBe(1);
    expect(back.skills.dev.versions).toHaveLength(3);
    expect(rollback(back, "dev", 3).skills.dev.current).toBe(3);
    expect(rollback(week, "dev", 9)).toBe(week);
  });

  it("has the lead's review propose a cheaper model, once", () => {
    const reviewed = runReview(weekState());
    expect(ticket(reviewed, "cheaperModel").status).toBe("proposed");
    expect(runReview(reviewed).tickets).toHaveLength(reviewed.tickets.length);
    const applied = answerProposal(reviewed, "cheaperModel", true);
    expect(applied.members.ops.model).toBe(FIXTURES.cheaperModel.change?.model);
  });

  it("counts first passes and rework per executor", () => {
    const dev = metricsOf(weekState(), "dev");
    expect(dev.verified).toBe(2);
    expect(dev.firstPass).toBe(0);
    expect(dev.rework).toBe(2);
  });
});

describe("setting a company up", () => {
  it("hires one executor per kind of work and files a first ticket for each", () => {
    const started = startCompany(freshState(), SETUP);
    expect(started.stage).toBe("running");
    expect(started.hired).toEqual(["dev", "ops"]);
    expect(started.tickets.map((t) => t.id)).toEqual([STARTERS.code, STARTERS.document]);
    expect(started.did).toContain("create");
  });

  it("holds the new company to the limits the reader chose", () => {
    const started = startCompany(freshState(), { ...SETUP, budget: 2, rounds: 1 });
    for (const t of started.tickets) {
      expect(t.budget).toBeLessThanOrEqual(2);
      expect(t.rounds.limit).toBe(1);
    }
  });

  it("keeps the reader's model choices", () => {
    const started = startCompany(freshState(), { ...SETUP, models: { dev: "minimax-m3" } });
    expect(started.members.dev.model).toBe("minimax-m3");
  });

  it("files no event tickets when the reader turned events off", () => {
    const started = startCompany(freshState(), { ...SETUP, events: false });
    expect(ticketOf(pass(started, 3), "installWin")).toBeUndefined();
  });

  it("brings its first tickets to the inbox as time passes", () => {
    const started = startCompany(freshState(), {
      ...SETUP,
      work: ["code", "experiment", "document", "ledger", "outreach"],
    });
    const later = pass(started, 6);
    expect(groupCounts(later).decide).toBeGreaterThanOrEqual(4);
  });
});

describe("the lead's conversation", () => {
  it("files a request only once the reader confirms the draft ticket", () => {
    const asked = askLead(weekState(), "pricing", null);
    expect(ticketOf(asked, "pricing")).toBeUndefined();
    expect(suggestions(asked)).not.toContain("pricing");
    const filed = fileRequest(asked, 1);
    expect(ticket(filed, "pricing").status).toBe("working");
    expect(filed.did).toContain("request");
    expect(fileRequest(filed, 1)).toBe(filed);
  });

  it("names a request in the reader's own words by those words", () => {
    const filed = fileRequest(askLead(weekState(), null, "整理一份 FAQ"), 1);
    const t = filed.tickets.at(-1)!;
    expect(t.text).toBe("整理一份 FAQ");
    expect(t.source).toBe("user");
  });
});
