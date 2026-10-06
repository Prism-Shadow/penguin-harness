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
