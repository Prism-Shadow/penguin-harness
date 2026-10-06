/**
 * Which roadmaps each proposal belongs to, as the reads answer it (`ProposalItem.roadmaps`).
 * This plugin stores nothing of roadmaps beyond the number a proposal created by one records;
 * company-roadmaps owns the delegations that link its items to proposals and provides the
 * lookup (ProposalRoadmapLinks, ports.ts) while its App runs.
 */
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import type { ProposalRoadmapRef } from "@prismshadow/penguin-server/api";
import type { ProposalRoadmapLinks } from "./ports.js";

export class RoadmapLinks {
  private links: ProposalRoadmapLinks | null = null;

  /** The roadmaps plugin's lookup; answers how to withdraw it, which leaves a later provider in place. */
  provide(links: ProposalRoadmapLinks): () => void {
    this.links = links;
    return () => {
      if (this.links === links) this.links = null;
    };
  }

  /** Each proposal's roadmaps, by proposal number, in roadmap order; empty without a provider. */
  async byProposal(
    projectId: string,
    orgId: string,
    actor: OrgActor,
  ): Promise<ReadonlyMap<number, ProposalRoadmapRef[]>> {
    const out = new Map<number, ProposalRoadmapRef[]>();
    if (this.links === null) return out;
    const rows = await this.links(projectId, orgId, actor);
    const ordered = [...rows].sort((a, b) => a.number - b.number);
    for (const row of ordered) {
      const refs = out.get(row.proposal) ?? [];
      refs.push({ number: row.number, name: row.name, itemKey: row.itemKey });
      out.set(row.proposal, refs);
    }
    return out;
  }
}
