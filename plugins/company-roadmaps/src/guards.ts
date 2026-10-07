/**
 * The default guards of the roadmap Actions, and the approval rule they share with the write.
 * A guard answers whether a run may go ahead, in which state; a company workflow may replace any
 * of them. The store guarantees only the data and an append-only history, so the rules here —
 * which status takes which step, which roles approve an item's brief, that an approval counts
 * only for the brief it was given on — are defaults.
 *
 * The defaults do not tell a person from an employee, but for `roadmap.members`: a roadmap's
 * members and moderator are changed by a person or its moderator. An item's brief is approved in
 * the moderator's role and any other member's; a company workflow that replaces the guard of
 * `roadmap.item.approve` names other roles by handing them to the default it wraps
 * ({@link withApprovalRoles}), and the guard's verdict carries the roles to the write. The
 * approval that fills the last role creates the item's proposal.
 *
 * Each guard is synchronous and pure over the roadmap it is given; a write asks it again inside
 * its transaction, so nothing slips between a check and its write.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  RoadmapError,
  type ApprovalRole,
  type DraftItem,
  type Roadmap,
  type RoadmapStatus,
} from "./domain.js";
import type {
  ActionCaller,
  Guard,
  GuardCode,
  GuardInput,
  RunContext,
  Subject,
} from "./action-shapes.js";

/** The caller, resolved: the principal a write is recorded under, and the employee it is, if one. */
export interface Caller {
  principal: string;
  agentId: string | null;
}

/** The employee who moderates: the one a `members` write named, once one did; until then the first member. */
export function moderatorOf(r: Roadmap): string | null {
  return r.explicitModerator ?? r.employees[0] ?? null;
}

export function requireStatus(r: Roadmap, status: RoadmapStatus): void {
  if (r.status !== status) {
    throw new RoadmapError(409, `not_${status}`, `Roadmap #${r.number} is ${r.status}.`);
  }
}

/** The approval roles by default: the moderator's, and any other member's. */
export const DEFAULT_APPROVAL_ROLES: readonly string[] = ["moderator", "member"];

/**
 * The approval roles `options.roles` names, checked: `moderator` (the roadmap's moderator),
 * `member` (anyone but the moderator), `person`, `employee`, `any`. Unknown names are dropped;
 * none left is the default.
 */
export function rolesOf(options: Record<string, unknown> | undefined): string[] {
  const known = new Set(["moderator", "member", "person", "employee", "any"]);
  const raw = Array.isArray(options?.roles) ? options.roles : [];
  const roles = raw.filter((x): x is string => typeof x === "string" && known.has(x));
  return roles.length > 0 ? [...new Set(roles)] : [...DEFAULT_APPROVAL_ROLES];
}

function fits(role: string, r: Roadmap, caller: Caller): boolean {
  const moderator = moderatorOf(r);
  switch (role) {
    case "moderator":
      return caller.agentId !== null && caller.agentId === moderator;
    case "member":
      return caller.agentId === null || caller.agentId !== moderator;
    case "person":
      return caller.agentId === null;
    case "employee":
      return caller.agentId !== null;
    default:
      return true;
  }
}

/** The proposal item `key` still waiting for approvals, or the refusal. */
function briefItem(r: Roadmap, key: string): DraftItem & { kind: "proposal" } {
  requireStatus(r, "established");
  const item = r.items.find((x) => x.key === key);
  const d = r.delegations[key];
  if (item === undefined || item.kind !== "proposal" || d === undefined) {
    throw new RoadmapError(
      404,
      "item_not_found",
      `Roadmap #${r.number} has established no proposal item ${key}.`,
    );
  }
  if (d.stage !== "brief") {
    throw new RoadmapError(409, "already_approved", `Item ${key} is approved already.`);
  }
  return item;
}

/**
 * The role the caller approves item `key` in: the first role of `roles` it fits that has no
 * approval of this brief yet, never a second role for a principal that approved already.
 * Answers it, and whether it is the last one missing (the approval that creates the proposal).
 */
export function approvalRole(
  r: Roadmap,
  key: string,
  caller: Caller,
  roles: readonly string[],
): { role: ApprovalRole; item: DraftItem & { kind: "proposal" }; last: boolean } {
  const item = briefItem(r, key);
  const approvals = r.delegations[key]!.approvals;
  const given = Object.entries(approvals);
  const mine = given.find(([, a]) => a.by === caller.principal);
  if (mine !== undefined) {
    throw new RoadmapError(
      409,
      "already_approved",
      `Item ${key} has your approval already (as ${mine[0]}).`,
    );
  }
  const open = roles.filter((role) => approvals[role] === undefined);
  const role = open.find((x) => fits(x, r, caller));
  if (role === undefined) {
    const filled = roles.filter((x) => approvals[x] !== undefined && fits(x, r, caller));
    if (filled.length > 0) {
      throw new RoadmapError(
        409,
        "already_approved",
        `Item ${key} has the ${filled.join(", ")} approval already (${approvals[filled[0]!]!.by}).`,
      );
    }
    throw new RoadmapError(
      403,
      "not_approver",
      `Item ${key} waits for the ${open.join(", ")} approval${open.length === 1 ? "" : "s"} (moderator: ${moderatorOf(r) ?? "none"}); you are not in that role.`,
    );
  }
  return { role, item, last: open.length === 1 };
}

/** The roadmap a guard is asked about; null before it exists (`roadmap.open`). */
function roadmapOf(input: GuardInput): Roadmap | null {
  return (input.state as Roadmap | null) ?? null;
}

function onRoadmap(
  check: (r: Roadmap, input: GuardInput, options?: Record<string, unknown>) => unknown,
): Guard {
  return (input, options) => {
    const r = roadmapOf(input);
    return r === null ? undefined : check(r, input, options);
  };
}

function itemKey(subject: Subject): string {
  const at = subject.id.indexOf("/");
  return at < 0 ? "" : subject.id.slice(at + 1);
}

const allow: Guard = () => undefined;

/** The default guard of each built-in roadmap Action, by key. */
export const roadmapGuards: Record<string, Guard> = {
  "roadmap.open": allow,
  "roadmap.draft": onRoadmap((r) => requireStatus(r, "discussing")),
  "roadmap.item.add": onRoadmap((r) => requireStatus(r, "discussing")),
  "roadmap.item.remove": onRoadmap((r) => requireStatus(r, "discussing")),
  "roadmap.establish": onRoadmap((r) => requireStatus(r, "discussing")),

  /**
   * One of an item's approvals, in one of the roles handed in `options.roles` (the default
   * ones without); inside the write, only on the brief the approval was read on
   * (`params.brief`). Its verdict is the roles it judged by: the write records the approval in
   * one of them.
   */
  "roadmap.item.approve": onRoadmap((r, { caller, subject, params }, options) => {
    const key = itemKey(subject);
    const roles = rolesOf(options);
    approvalRole(r, key, caller, roles);
    if (typeof params.brief === "string" && r.delegations[key]?.brief !== params.brief) {
      throw new RoadmapError(
        409,
        "brief_changed",
        `Item ${key}'s brief changed while it was being approved; read it again and approve that one.`,
      );
    }
    return { roles };
  }),

  /**
   * An item still a brief is linked only to say what it is — a proposal that exists already —
   * and not by its own owner, which is what its approvals are there to gate.
   */
  "roadmap.item.link": onRoadmap((r, { caller, subject }) => {
    const key = itemKey(subject);
    const d = r.delegations[key];
    const item = r.items.find((x) => x.key === key);
    if (d === undefined || item === undefined || item.kind !== "proposal") {
      throw new RoadmapError(
        404,
        "item_not_delegated",
        `Roadmap #${r.number} has delegated no proposal item ${key}.`,
      );
    }
    if (d.stage === "brief" && caller.agentId !== null && caller.agentId === d.owner) {
      throw new RoadmapError(
        409,
        "not_approved",
        `Item ${key} is still a brief: its owner links it only once it is approved (anyone else may link it to the proposal it already is).`,
      );
    }
  }),

  "roadmap.adopt": onRoadmap((r) => {
    if (r.status !== "discussing" && r.status !== "established") {
      throw new RoadmapError(
        409,
        "not_adoptable",
        `Roadmap #${r.number} is ${r.status}: a proposal is taken in while its room discusses it or once it is established.`,
      );
    }
  }),

  "roadmap.reopen": onRoadmap((r) => requireStatus(r, "established")),
  "roadmap.rename": allow,
  "roadmap.room": onRoadmap((r) => requireStatus(r, "awaiting_room")),

  /**
   * A person, or the roadmap's moderator as it stands (the one a departed moderator would be
   * replaced by is named by a person). In any status.
   */
  "roadmap.members": onRoadmap((r, { caller }) => {
    const moderator = moderatorOf(r);
    if (caller.agentId === null || caller.agentId === moderator) return;
    throw new RoadmapError(
      403,
      "not_moderator",
      `Roadmap #${r.number}'s members are changed by a person or its moderator (${moderator ?? "none"}).`,
    );
  }),
};

/**
 * A guard replacement that keeps the default rules of `roadmap.item.approve` and approves in
 * `roles` instead of the default ones. A company workflow writes the same thing inline —
 * `(defaults) => (input, options) => defaults(input, { ...options, roles: [...] })` — since its
 * code imports nothing at run time.
 */
export function withApprovalRoles(roles: readonly string[]): GuardCode {
  return (defaults) => (input, options) => defaults(input, { ...options, roles: [...roles] });
}

/** The approval roles a guard's verdict carries; the default ones when it carries none. */
export function verdictRoles(verdict: unknown): string[] {
  const roles = (verdict as { roles?: unknown } | null | undefined)?.roles;
  return rolesOf(Array.isArray(roles) ? { roles } : undefined);
}

/**
 * What a write runs under: the guard of its Action, asked with the roadmap as it stands —
 * before the write, and again inside it — and the run's transaction hook. `check` answers the
 * guard's verdict.
 */
export interface WriteAct {
  check(state: Roadmap | null, opts?: { params?: Record<string, unknown> }): unknown;
  inTx?: (db: DatabaseSync) => void;
  /** The run's notices (notices.ts); absent, a use case delivers what the built-in notify Action would. */
  notify?: RunContext["act"]["notify"];
}

/** The default guard of `key`, for `caller` on `subject` (a use case called directly). */
export function defaultAct(key: string, caller: Caller, subject: Subject): WriteAct {
  const guard = roadmapGuards[key] ?? allow;
  const full: ActionCaller = { principal: caller.principal, agentId: caller.agentId, userId: "" };
  return {
    check: (state, opts) =>
      guard({ caller: full, subject, state, params: opts?.params ?? {}, running: 0 }),
  };
}
