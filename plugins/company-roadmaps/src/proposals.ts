/**
 * What this plugin requires of company-proposals: to create the proposal of an approved item.
 * The interface is the consumer's own — company-proposals knows nothing of roadmaps — and
 * index.ts wires it, by name, to the company-proposals module.
 */
import { Interface } from "@prismshadow/penguin-core/plugin";

@Interface()
export abstract class ProposalCreator {
  /**
   * Creates the proposal of roadmap item `roadmap.key` of roadmap `roadmap.number`, written by
   * `author`, and answers its number. `delegatedBy` is the principal whose approval completed
   * the pair.
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
}
