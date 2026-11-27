/**
 * The roadmap room's column, as rows: every item of the roadmap, the proposal items first and
 * the roadmap items after them, each in the draft's own order, with what became of it. Pure,
 * so a row's suite stands in for the read.
 */
import type { OrgRoadmapApproval, OrgRoadmapDetail } from "./api";

/** Where an item stands, as its row says it: `draft` while the roadmap is still discussed, `brief` once established but still waiting for its approvals (a proposal item), and `delegated` once it went out. */
export type RoadmapRowStage = "draft" | "brief" | "delegated";

/** One row of the room's column: an item of the roadmap, with what became of it. */
export interface RoadmapRow {
  key: string;
  kind: "proposal" | "roadmap";
  title: string;
  brief: string;
  /** Who the row names, as principals (`agent:<id>`): a proposal item's owner, a roadmap item's employees. */
  people: string[];
  /** The proposal of a proposal item: the one linked back, or the existing one it took in. */
  proposal: number | null;
  /** The roadmap a roadmap item derived, when there is one. */
  child: number | null;
  stage: RoadmapRowStage;
  /** The approvals a brief has, by role (null where the row is not a brief). */
  approvals: Array<{ role: string; approval: OrgRoadmapApproval }> | null;
}

/** The column's rows: every item of the roadmap, the proposal items first and the roadmap items after them, each in the draft's own order. */
export function roadmapRows(r: OrgRoadmapDetail): RoadmapRow[] {
  const established = r.status === "established";
  const rows = r.items.map((item): RoadmapRow => {
    const d = r.delegations[item.key];
    const stage: RoadmapRowStage = !established
      ? "draft"
      : d !== undefined && d.stage === "brief"
        ? "brief"
        : "delegated";
    return {
      key: item.key,
      kind: item.kind,
      title: item.title,
      brief: item.brief,
      people: (item.kind === "proposal" ? [item.owner] : item.employees).map((id) => `agent:${id}`),
      proposal: item.kind === "proposal" ? (d?.proposal ?? item.proposal ?? null) : null,
      child: item.kind === "roadmap" && d !== undefined ? d.child : null,
      stage,
      approvals:
        stage === "brief"
          ? Object.entries(d?.approvals ?? {}).map(([role, approval]) => ({ role, approval }))
          : null,
    };
  });
  return [
    ...rows.filter((x) => x.kind === "proposal"),
    ...rows.filter((x) => x.kind === "roadmap"),
  ];
}
