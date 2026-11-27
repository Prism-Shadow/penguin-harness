/**
 * `proposal.author`: a proposal handed to another author.
 *
 * The author is named when a proposal is created; this is the one write that changes it — the
 * way out for a proposal whose author left the organization, and how a roadmap's proposals
 * come under the employee that carries the roadmap. The write replaces the author on the
 * proposal and appends an `author` event that names the author before and after, under the
 * caller; whatever reads the author from then on — the ready check of requested changes, the
 * desk lines of a rewritten brief or a feedback, the default implementer — reads the new one.
 * The revisions, comments and approvals stand as they are.
 *
 * The default guard (guards.ts) lets a person do it, and the moderator of the roadmap that
 * created the proposal (the one the proposal records; a roadmap that adopted it later is not
 * asked), which the roadmaps plugin answers through RoadmapModeratorOf.
 */
import type { ProposalDetail } from "@prismshadow/penguin-server/api";
import type { OrgActor, OrgView } from "@prismshadow/penguin-server/plugin";
import { parseSubject } from "./action-model.js";
import { ProposalError, type Proposal } from "./domain.js";
import { defaultAct, type Caller, type WriteAct } from "./guards.js";
import type { RoadmapModeratorOf } from "./ports.js";
import type { SqliteProposalStore } from "./store-write.js";

/** What `proposal.author` needs of the service: its plumbing, nothing of its state. */
export interface AuthorHost {
  open(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    act?: WriteAct,
  ): Promise<{ org: OrgView; store: SqliteProposalStore; caller: Caller }>;
  /** The roadmaps plugin's answer, while it provides one. */
  moderatorOf(): RoadmapModeratorOf | null;
  /** The project's live event for a write (the page reloads the proposal). */
  notify(org: OrgView, number: number, seq: number, kind: "author"): void;
  /** The skills plugin the author writes with, installed on demand. */
  ensureSkills(projectId: string, agentId: string): Promise<void>;
  /** The answer to a write: the proposal as it stands now, as the caller sees it. */
  view(store: SqliteProposalStore, number: number, caller: Caller): ProposalDetail;
}

/** The moderator of the roadmap that created `p`; null when no roadmap did or none answers. */
async function moderatorOf(
  host: AuthorHost,
  org: OrgView,
  p: Proposal,
  actor: OrgActor,
): Promise<string | null> {
  const ask = host.moderatorOf();
  if (p.roadmap === null || ask === null) return null;
  return ask(org.projectId, org.orgId, p.roadmap.number, actor);
}

/** Hands proposal `number` to `author`, an employee of the organization as it is now. */
export async function changeAuthor(
  host: AuthorHost,
  projectId: string,
  orgId: string,
  number: number,
  author: string,
  actor: OrgActor,
  act?: WriteAct,
): Promise<ProposalDetail> {
  const { org, store, caller } = await host.open(projectId, orgId, actor, act);
  const a = act ?? defaultAct("proposal.author", caller, parseSubject(`proposal:${number}`));
  const next = author.trim();
  if (!org.employees.some((e) => e.agentId === next)) {
    throw new ProposalError(
      400,
      "bad_request",
      `author must be an employee of ${org.orgId}: ${next}`,
    );
  }
  const before = store.get(number);
  if (before === null) {
    throw new ProposalError(404, "proposal_not_found", `Proposal #${number} does not exist.`);
  }
  const params = { author: next, moderator: await moderatorOf(host, org, before, actor) };
  a.check(before, { params });
  const written = store.setAuthor(number, (p, tx) => {
    a.check(p, { tx, params });
    return { author: next, by: caller.principal };
  });
  host.notify(org, number, written.seq, "author");
  await host.ensureSkills(projectId, next);
  return host.view(store, number, caller);
}
