/**
 * What this plugin requires of company-proposals: to create the proposal of an approved item,
 * or to rewrite the brief of the one it is linked to when its changed brief is approved again.
 * The interface is the consumer's own — company-proposals knows nothing of roadmaps — and
 * index.ts wires it, by name, to the company-proposals module.
 */
import { Interface } from "@prismshadow/penguin-core/plugin";

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
   * proposal that has the brief already answers true.
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
): Promise<{ number: number; rebriefed: boolean }> {
  const { linked, owner, title, ...rest } = req;
  if (
    linked !== undefined &&
    (await proposals.rebriefFromRoadmap(projectId, orgId, linked, { owner, ...rest }))
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
