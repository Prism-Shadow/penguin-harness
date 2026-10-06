/**
 * What this plugin requires of company-proposals: to create the proposal of an approved item,
 * or to rewrite the brief of the one it is linked to when its changed brief is approved again.
 * The interface is the consumer's own — company-proposals knows nothing of roadmaps — and
 * index.ts wires it, by name, to the company-proposals module.
 */
import { Interface } from "@prismshadow/penguin-core/plugin";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import { RoadmapError } from "./domain.js";
import type { WriteAct } from "./guards.js";
import type { RoadmapView } from "./service.js";

@Interface()
export abstract class ProposalCreator {
  /**
   * Creates the proposal of roadmap item `roadmap.key` of roadmap `roadmap.number`, written by
   * `author`, and answers its number. `delegatedBy` is the principal whose approval completed
   * the pair. Idempotent: the same item with the same brief answers the proposal created the
   * first time, so an approval retried after a failure between the creation and its record
   * links that one instead of creating a second.
   */
  abstract createFromRoadmap(
    projectId: string,
    orgId: string,
    req: {
      author: string;
      title: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
  ): Promise<number>;

  /**
   * Rewrites the brief of proposal `number`, which item `roadmap.key` is linked to, when the
   * item's changed brief has both approvals again: only the brief moves (its revisions,
   * comments and approvals stand), recorded under `delegatedBy`, and its author is told unless
   * it is `owner`, whom this plugin tells. Answers false, writing nothing, when that proposal is
   * merged or rejected (or does not exist): a new one is to be created instead. Idempotent: a
   * proposal that has the brief already answers true. `notify` is the approval run's notices:
   * the author is told through it (`notify.proposal.brief_edited`), as that run's notice.
   */
  abstract rebriefFromRoadmap(
    projectId: string,
    orgId: string,
    number: number,
    req: {
      owner: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
    notify?: WriteAct["notify"],
  ): Promise<boolean>;
}

/**
 * The proposal an item's second approval stands for: the one it is linked to, its brief
 * rewritten, while that one is open; otherwise one created from the item (and linked by the
 * caller). A brief changes on a re-establishment, which keeps the item's link — so without the
 * rewrite each changed brief would create another proposal for the same item.
 */
export async function proposalOfApproval(
  proposals: ProposalCreator,
  projectId: string,
  orgId: string,
  req: {
    linked: number | undefined;
    owner: string;
    title: string;
    brief: string;
    delegatedBy: string;
    roadmap: { number: number; key: string };
  },
  notify?: WriteAct["notify"],
): Promise<{ number: number; rebriefed: boolean }> {
  const { linked, owner, title, ...rest } = req;
  if (
    linked !== undefined &&
    (await proposals.rebriefFromRoadmap(projectId, orgId, linked, { owner, ...rest }, notify))
  ) {
    return { number: linked, rebriefed: true };
  }
  const number = await proposals.createFromRoadmap(projectId, orgId, {
    author: owner,
    title,
    ...rest,
  });
  return { number, rebriefed: false };
}

/**
 * Who moderates roadmap `number` now, as company-proposals asks it (its RoadmapModeratorOf, the
 * same signature): the default guard of `proposal.author` lets the moderator of the roadmap that
 * created a proposal hand it to another author. Null for a roadmap that does not exist.
 */
export type RoadmapModeratorOf = (
  projectId: string,
  orgId: string,
  number: number,
  actor: OrgActor,
) => Promise<string | null>;

/**
 * What this plugin provides to company-proposals while its App runs: the moderators, through
 * that plugin's module, by name (index.ts). Answers how to withdraw them.
 */
@Interface()
export abstract class ModeratorRegistration {
  abstract provideRoadmapModerators(moderatorOf: RoadmapModeratorOf): () => void;
}

/** The moderators the roadmaps' reads answer. */
export function roadmapModerators(roadmaps: {
  get(projectId: string, orgId: string, number: number, actor: OrgActor): Promise<RoadmapView>;
}): RoadmapModeratorOf {
  return async (projectId, orgId, number, actor) => {
    try {
      return (await roadmaps.get(projectId, orgId, number, actor)).moderator;
    } catch (err) {
      if (err instanceof RoadmapError && err.code === "roadmap_not_found") return null;
      throw err;
    }
  };
}

/**
 * Every proposal this organization's roadmap items lead to, as company-proposals asks it (its
 * ProposalRoadmapLinks, the same signature): one row per item whose delegation carries a
 * proposal number — created by the item's approval, adopted, or linked.
 */
export type ProposalRoadmapLinks = (
  projectId: string,
  orgId: string,
  actor: OrgActor,
) => Promise<{ proposal: number; number: number; name: string; itemKey: string }[]>;

/**
 * What this plugin provides to company-proposals while its App runs: the roadmaps each proposal
 * belongs to, through that plugin's module, by name (index.ts). Answers how to withdraw them.
 */
@Interface()
export abstract class ProposalRoadmapsRegistration {
  abstract provideProposalRoadmaps(links: ProposalRoadmapLinks): () => void;
}

/** The links the roadmaps' reads answer: every delegation that names a proposal, in roadmap and item order. */
export function proposalRoadmapLinks(roadmaps: {
  list(projectId: string, orgId: string, actor: OrgActor): Promise<{ roadmaps: RoadmapView[] }>;
}): ProposalRoadmapLinks {
  return async (projectId, orgId, actor) => {
    const { roadmaps: all } = await roadmaps.list(projectId, orgId, actor);
    const out: { proposal: number; number: number; name: string; itemKey: string }[] = [];
    for (const r of all) {
      // In the draft's item order; a delegation whose item a later draft dropped comes last.
      const keys = [
        ...r.items.map((i) => i.key),
        ...Object.keys(r.delegations).filter((k) => !r.items.some((i) => i.key === k)),
      ];
      for (const key of keys) {
        const d = r.delegations[key];
        if (d?.proposal === undefined) continue;
        out.push({ proposal: d.proposal, number: r.number, name: r.name, itemKey: key });
      }
    }
    return out;
  };
}
