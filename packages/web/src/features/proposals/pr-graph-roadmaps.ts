/**
 * Which roadmaps each proposal belongs to, for the PR graph's segment headings. The graph comes
 * from company-proposals and the roadmaps from company-roadmaps, so the page joins them: every
 * roadmap's items name the proposals they were delegated to or adopted (roadmapRows), and a
 * proposal may sit on more than one roadmap. Read once per graph load; a roadmap that fails to
 * read only leaves its proposals unnamed.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { roadmapRows } from "../company/roadmaps";
import type { RoadmapRef } from "./pr-graph-segments";

export function useProposalRoadmaps(
  projectId: string,
  orgId: string,
  /** Changes when the graph is read again, so the roadmaps are too. */
  round: unknown,
): ReadonlyMap<number, RoadmapRef[]> {
  const [byProposal, setByProposal] = useState<ReadonlyMap<number, RoadmapRef[]>>(new Map());
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await api.listOrgRoadmaps(projectId, orgId).catch(() => null);
      if (list === null) return;
      const details = await Promise.all(
        list.roadmaps.map((r) => api.getOrgRoadmap(projectId, orgId, r.number).catch(() => null)),
      );
      const map = new Map<number, RoadmapRef[]>();
      for (const d of details) {
        if (d === null) continue;
        const ref: RoadmapRef = { number: d.number, name: d.name, channelId: d.channelId };
        for (const row of roadmapRows(d)) {
          if (row.proposal === null) continue;
          const refs = map.get(row.proposal) ?? [];
          if (!refs.some((x) => x.number === ref.number)) refs.push(ref);
          map.set(row.proposal, refs);
        }
      }
      if (alive) setByProposal(map);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, orgId, round]);
  return byProposal;
}
