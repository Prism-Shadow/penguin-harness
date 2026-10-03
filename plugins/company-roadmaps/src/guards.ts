/**
 * The default rules of the roadmap operations: who may do what and in which state, and the
 * approval rules the store does not check — an approval counts only for the brief it was given
 * on (its hash), each role approves a brief once, the second approval creates the proposal. They
 * are the rules the service has always applied, error codes and messages included, gathered as
 * plain functions so they can be replaced (ServiceDeps.rules); the rules that tell a person from
 * an employee are kept as they are.
 *
 * Each is synchronous and pure over the roadmap it is given; the write transaction calls it again
 * with the roadmap as it stands there, so nothing slips between a check and its write.
 */
import {
  RoadmapError,
  type ApprovalRole,
  type DraftItem,
  type Roadmap,
  type RoadmapStatus,
} from "./domain.js";

/** The caller, resolved: the principal a write is recorded under, and the employee it is, if one. */
export interface Caller {
  principal: string;
  agentId: string | null;
}

/** The employee who moderates: the first of the opening employees with an open room session, else the first opener, else the earliest open session. */
export function moderatorOf(r: Roadmap): string | null {
  const open = r.clones.filter((c) => c.closedAt === undefined).map((c) => c.agentId);
  return r.employees.find((e) => open.includes(e)) ?? open[0] ?? r.employees[0] ?? null;
}

export const defaultRules = {
  requireStatus(r: Roadmap, status: RoadmapStatus): void {
    if (r.status !== status) {
      throw new RoadmapError(409, `not_${status}`, `Roadmap #${r.number} is ${r.status}.`);
    }
  },

  /** People, or the moderator: the draft, the establishment, the room, the name, an adoption. */
  moderatorOrPerson(r: Roadmap, caller: Caller): void {
    if (caller.agentId === null || caller.agentId === moderatorOf(r)) return;
    throw new RoadmapError(
      403,
      "not_moderator",
      `Only a person or the moderator (${moderatorOf(r)}) may do this.`,
    );
  },

  /**
   * One of the two approvals a proposal item needs: a person approves as the person, the
   * moderator as the moderator; nobody else, and nobody twice for the same brief. Only an
   * established roadmap's items, while they are briefs. Answers the role, and whether this is
   * the second approval (the one that creates the proposal).
   */
  approve(
    r: Roadmap,
    key: string,
    caller: Caller,
  ): { role: ApprovalRole; item: DraftItem & { kind: "proposal" }; second: boolean } {
    defaultRules.requireStatus(r, "established");
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
    const moderator = moderatorOf(r);
    const role: ApprovalRole | null =
      caller.agentId === null ? "person" : caller.agentId === moderator ? "moderator" : null;
    if (role === null) {
      throw new RoadmapError(
        403,
        "not_approver",
        `Only a person or the moderator (${moderator ?? "none"}) approves item ${key}.`,
      );
    }
    if (d.approvals[role] !== undefined) {
      throw new RoadmapError(
        409,
        "already_approved",
        `Item ${key} has the ${role}'s approval already (${d.approvals[role]!.by}).`,
      );
    }
    const other = role === "person" ? d.approvals.moderator : d.approvals.person;
    return { role, item, second: other !== undefined };
  },

  /** An approval is recorded only on the brief it was given on. */
  approvalOnBrief(r: Roadmap, key: string, brief: string): void {
    if (r.delegations[key]?.brief !== brief) {
      throw new RoadmapError(
        409,
        "brief_changed",
        `Item ${key}'s brief changed while it was being approved; read it again and approve that one.`,
      );
    }
  },

  /**
   * Who links a proposal to an item. An item still a brief is linked only by a person or a
   * moderator that does not own it, and only to the proposal it already is (it is delegated and
   * linked at once, with no approvals); otherwise its owner or a person links it.
   */
  link(r: Roadmap, key: string, caller: Caller): { existing: boolean } {
    const d = r.delegations[key];
    const item = r.items.find((x) => x.key === key);
    if (d === undefined || item === undefined || item.kind !== "proposal") {
      throw new RoadmapError(
        404,
        "item_not_delegated",
        `Roadmap #${r.number} has delegated no proposal item ${key}.`,
      );
    }
    // A moderator who owns the item is not asked: that is the owner linking a card of its own
    // before the approvals, which is what the gate is there to stop.
    const existing =
      d.stage === "brief" &&
      (caller.agentId === null ||
        (caller.agentId === moderatorOf(r) && caller.agentId !== d.owner));
    if (d.stage === "brief" && !existing) {
      throw new RoadmapError(
        409,
        "not_approved",
        `Item ${key} is still a brief: it needs a person's and the moderator's approval before a proposal is linked to it (a person or the moderator links it to the proposal it already is).`,
      );
    }
    if (!existing && caller.agentId !== null && caller.agentId !== d.owner) {
      throw new RoadmapError(403, "not_owner", `Only ${d.owner} (or a person) links ${key}.`);
    }
    return { existing };
  },

  /** A proposal is taken in while the room discusses or once the roadmap is established, by a person or the moderator. */
  adopt(r: Roadmap, caller: Caller): void {
    if (r.status !== "discussing" && r.status !== "established") {
      throw new RoadmapError(
        409,
        "not_adoptable",
        `Roadmap #${r.number} is ${r.status}: a proposal is taken in while its room discusses it or once it is established.`,
      );
    }
    defaultRules.moderatorOrPerson(r, caller);
  },

  /** An owner, an employee of the room, or a person reopens an established roadmap. */
  reopen(r: Roadmap, caller: Caller): void {
    defaultRules.requireStatus(r, "established");
    if (caller.agentId === null) return;
    const owners = Object.values(r.delegations).map((d) => d.owner);
    const room = [...r.employees, ...r.clones.map((c) => c.agentId)];
    if (!owners.includes(caller.agentId) && !room.includes(caller.agentId)) {
      throw new RoadmapError(
        403,
        "not_involved",
        `Only an owner, an employee of the room, or a person reopens roadmap #${r.number}.`,
      );
    }
  },
};

export type RoadmapRules = typeof defaultRules;
