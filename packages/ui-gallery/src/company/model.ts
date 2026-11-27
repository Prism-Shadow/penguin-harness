export type Role = "lead" | "executor" | "verifier";

export type Stage = "working" | "verifying" | "yours" | "halted" | "done";

export const BOARD_STAGES: readonly Stage[] = ["working", "verifying", "yours", "done"];

export type Grade = "draft" | "approve" | "review";

export interface Member {
  id: string;
  name: string;
  role: Role;
  duty: string;
  model: string;
  machine: string;
  skill: string;
  skillVersion: number;
}

export interface DecisionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export type Need =
  | { kind: "decision"; question: string; options: readonly DecisionOption[]; rule: string }
  | { kind: "accept"; verdict: string; grade: Grade; workbench: string; workbenchApp: string }
  | { kind: "breaker"; reason: "rounds" | "budget"; verdict: string };

export interface LogLine {
  at: string;
  text: string;
}

export interface Ticket {
  id: string;
  title: string;
  stage: Stage;
  executor: string;
  verifier: string;
  rounds: number;
  maxRounds: number;
  spent: number;
  budget: number;
  source: "lead" | "schedule";
  updated: string;
  need?: Need;
  outcome?: string;
  log: readonly LogLine[];
}

export interface HandbookLine {
  id: string;
  kind: "rule" | "lesson";
  text: string;
  ticket: string;
  member?: string;
}

export interface Org {
  id: string;
  name: string;
  goal: string;
  members: readonly Member[];
  tickets: readonly Ticket[];
  handbook: readonly HandbookLine[];
}

export interface Notes {
  now: string;
  decided: (answer: string) => string;
  accepted: string;
  sentBack: (note: string) => string;
  resumed: string;
  stopped: string;
  stoppedOutcome: string;
  acceptedOutcome: string;
}

export const BUDGET_STEP = 2;

function withTicket(org: Org, id: string, change: (ticket: Ticket) => Ticket): Org {
  return {
    ...org,
    tickets: org.tickets.map((ticket) => (ticket.id === id ? change(ticket) : ticket)),
  };
}

function logged(ticket: Ticket, notes: Notes, text: string): readonly LogLine[] {
  return [...ticket.log, { at: notes.now, text }];
}

export function ticketById(org: Org, id: string): Ticket | undefined {
  return org.tickets.find((ticket) => ticket.id === id);
}

export function memberById(org: Org, id: string): Member | undefined {
  return org.members.find((member) => member.id === id);
}

export function waitingOnYou(org: Org): readonly Ticket[] {
  return org.tickets.filter((ticket) => ticket.need !== undefined);
}

export function inProgress(org: Org): readonly Ticket[] {
  return org.tickets.filter(
    (ticket) =>
      ticket.need === undefined && (ticket.stage === "working" || ticket.stage === "verifying"),
  );
}

export function settled(org: Org): readonly Ticket[] {
  return org.tickets.filter((ticket) => ticket.stage === "done");
}

export function boardColumn(org: Org, stage: Stage): readonly Ticket[] {
  if (stage === "yours")
    return org.tickets.filter((t) => t.stage === "yours" || t.stage === "halted");
  return org.tickets.filter((ticket) => ticket.stage === stage);
}

export function decide(org: Org, id: string, answer: string, notes: Notes): Org {
  const ticket = ticketById(org, id);
  if (ticket?.need?.kind !== "decision") return org;
  const rule = ticket.need.rule.replace("{answer}", answer);
  const next = withTicket(org, id, (t) => {
    const { need: _need, ...rest } = t;
    return {
      ...rest,
      stage: "working",
      updated: notes.now,
      log: logged(t, notes, notes.decided(answer)),
    };
  });
  return {
    ...next,
    handbook: [...next.handbook, { id: `rule-${id}`, kind: "rule", text: rule, ticket: id }],
  };
}

export function accept(org: Org, id: string, notes: Notes): Org {
  const ticket = ticketById(org, id);
  if (ticket?.need?.kind !== "accept") return org;
  return withTicket(org, id, (t) => {
    const { need: _need, ...rest } = t;
    return {
      ...rest,
      stage: "done",
      updated: notes.now,
      outcome: notes.acceptedOutcome,
      log: logged(t, notes, notes.accepted),
    };
  });
}

export function sendBack(org: Org, id: string, note: string, notes: Notes): Org {
  const ticket = ticketById(org, id);
  const reason = note.trim();
  if (ticket?.need?.kind !== "accept" || reason === "") return org;
  const rounds = ticket.rounds + 1;
  const halted = rounds >= ticket.maxRounds;
  const next = withTicket(org, id, (t) => {
    const { need: _need, ...rest } = t;
    return {
      ...rest,
      rounds,
      stage: halted ? "halted" : "working",
      updated: notes.now,
      log: logged(t, notes, notes.sentBack(reason)),
      ...(halted ? { need: { kind: "breaker", reason: "rounds", verdict: reason } as const } : {}),
    };
  });
  return {
    ...next,
    members: next.members.map((member) =>
      member.id === ticket.executor ? { ...member, skillVersion: member.skillVersion + 1 } : member,
    ),
    handbook: [
      ...next.handbook,
      {
        id: `lesson-${id}-${rounds}`,
        kind: "lesson",
        text: reason,
        ticket: id,
        member: ticket.executor,
      },
    ],
  };
}

export function resume(org: Org, id: string, notes: Notes): Org {
  const ticket = ticketById(org, id);
  if (ticket?.need?.kind !== "breaker") return org;
  const rounds = ticket.need.reason === "rounds";
  return withTicket(org, id, (t) => {
    const { need: _need, ...rest } = t;
    return {
      ...rest,
      stage: "working",
      updated: notes.now,
      maxRounds: rounds ? t.maxRounds + 1 : t.maxRounds,
      budget: rounds ? t.budget : t.budget + BUDGET_STEP,
      log: logged(t, notes, notes.resumed),
    };
  });
}

export function stop(org: Org, id: string, notes: Notes): Org {
  const ticket = ticketById(org, id);
  if (ticket === undefined || ticket.stage === "done") return org;
  return withTicket(org, id, (t) => {
    const { need: _need, ...rest } = t;
    return {
      ...rest,
      stage: "done",
      updated: notes.now,
      outcome: notes.stoppedOutcome,
      log: logged(t, notes, notes.stopped),
    };
  });
}

export function rollBack(org: Org, memberId: string): Org {
  return {
    ...org,
    members: org.members.map((member) =>
      member.id === memberId && member.skillVersion > 1
        ? { ...member, skillVersion: member.skillVersion - 1 }
        : member,
    ),
  };
}
