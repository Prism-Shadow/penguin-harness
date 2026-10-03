/**
 * A roadmap in its room's column (features/company/roadmap-detail.tsx and the rows of
 * features/company/roadmaps.ts), via react-dom/server static markup: the items come before the
 * body, proposal items before roadmap items; a linked item is its proposal's row (number, title,
 * status), an unlinked one says its stage, and a brief shows its two approvals with the person's
 * Approve while theirs is missing; every employee is a face and a name, never an id; the record is
 * not drawn; the body is Markdown (headings, `proposal:<n>` capsules, footnotes) with no card.
 *
 * The employee face reads the company store, which a static render has no provider for: it is
 * stood in by a marker carrying the id, so the test reads that a face is drawn for whom.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalItem } from "@prismshadow/penguin-server/api";
import type { OrgRoadmapDetail } from "../src/api/endpoints";

vi.mock("../src/features/company/employee-avatar", () => ({
  EmployeeAvatar: (props: { id: string }) => createElement("i", { "data-face": props.id }),
}));
vi.mock("../src/state/locale", () => ({ useLocale: () => ({ locale: "en" }) }));

const roadmapDetail = await import("../src/features/company/roadmap-detail");
const { RoadmapBody, RoadmapDetailView } = roadmapDetail;
const { personMayApprove, roadmapRows } = await import("../src/features/company/roadmaps");
const { S } = await import("../src/lib/strings");

const roadmap = (over: Partial<OrgRoadmapDetail> = {}): OrgRoadmapDetail => ({
  number: 3,
  name: "Company Proposal & Roadmap",
  status: "established",
  archived: true,
  channelId: "roadmap_3",
  createdAt: "2026-09-29T02:59:46.000Z",
  moderator: "acme_ceo",
  body: "## Scope\n\nThe column.",
  items: [
    { key: "r", kind: "roadmap", title: "Derived", brief: "a child", employees: ["acme_web"] },
    { key: "a", kind: "proposal", title: "Right column", brief: "brief a", owner: "acme_plugin" },
    { key: "b", kind: "proposal", title: "Sidebar", brief: "brief b", owner: "acme_web" },
  ],
  delegations: {
    a: {
      key: "a",
      owner: "acme_plugin",
      child: null,
      proposal: 105,
      stage: "delegated",
      approvals: {
        person: { by: "user:admin", at: "2026-09-29T03:33:30.000Z" },
        moderator: { by: "agent:acme_ceo", at: "2026-09-29T03:28:54.000Z" },
      },
    },
    b: {
      key: "b",
      owner: "acme_web",
      child: null,
      stage: "brief",
      approvals: { moderator: { by: "agent:acme_ceo", at: "2026-09-29T03:28:54.000Z" } },
    },
    r: { key: "r", owner: "acme_web", child: 4 },
  },
  ...over,
});

const names = new Map([
  ["acme_ceo", "Yuki"],
  ["acme_plugin", "Dev (Plugin)"],
  ["acme_web", "Dev (Web)"],
]);

const proposal105 = {
  number: 105,
  title: "改进roadmap room页面（右栏的改进）",
  status: "ready",
} as ProposalItem;

const render = (r: OrgRoadmapDetail, proposals = new Map([[105, proposal105]])) =>
  renderToStaticMarkup(
    createElement(RoadmapDetailView, {
      roadmap: r,
      names,
      proposals,
      approving: null,
      onApprove: () => {},
      onOpenProposal: () => {},
    }),
  );

describe("the column's rows", () => {
  it("lists proposal items first, then roadmap items, each in the draft's order", () => {
    expect(roadmapRows(roadmap()).map((row) => row.key)).toEqual(["a", "b", "r"]);
  });

  it("takes a linked proposal's number, a derived roadmap's number, and a brief's approvals", () => {
    const [a, b, r] = roadmapRows(roadmap());
    expect(a).toMatchObject({ proposal: 105, stage: "delegated", approvals: null });
    expect(b).toMatchObject({ proposal: null, stage: "brief", people: ["agent:acme_web"] });
    expect(b?.approvals).toEqual({
      person: null,
      moderator: { by: "agent:acme_ceo", at: "2026-09-29T03:28:54.000Z" },
    });
    expect(r).toMatchObject({ child: 4, people: ["agent:acme_web"] });
  });

  it("calls every item a draft while the roadmap is discussed, and offers no approval", () => {
    const rows = roadmapRows(roadmap({ status: "discussing", archived: false }));
    expect(rows.every((row) => row.stage === "draft" && row.approvals === null)).toBe(true);
    expect(rows.some(personMayApprove)).toBe(false);
  });

  it("takes an adopted proposal's number while the roadmap is still discussed", () => {
    const r = roadmap({ status: "discussing", archived: false, delegations: {} });
    r.items[1] = { ...r.items[1]!, proposal: 105 } as OrgRoadmapDetail["items"][number];
    expect(roadmapRows(r)[0]).toMatchObject({ key: "a", proposal: 105, stage: "draft" });
  });

  it("offers the person's approval only on a brief that does not have it yet", () => {
    const [a, b] = roadmapRows(roadmap());
    expect(personMayApprove(a!)).toBe(false);
    expect(personMayApprove(b!)).toBe(true);
    const approved = roadmap();
    approved.delegations.b!.approvals!.person = { by: "user:admin", at: "2026-09-29T03:40:00Z" };
    expect(personMayApprove(roadmapRows(approved)[1]!)).toBe(false);
  });

  it("reads a delegation from before the gate (no stage) as delegated", () => {
    const old = roadmap();
    delete old.delegations.b!.stage;
    expect(roadmapRows(old)[1]).toMatchObject({ stage: "delegated", approvals: null });
  });
});

describe("the column", () => {
  const html = render(roadmap());

  it("puts the items before the body", () => {
    const body = html.indexOf("<h2>Scope</h2>");
    expect(body).toBeGreaterThan(-1);
    expect(html.indexOf(S.company.roadmaps.proposals)).toBeGreaterThan(-1);
    expect(html.indexOf(S.company.roadmaps.proposals)).toBeLessThan(body);
    expect(html.indexOf("Sidebar")).toBeLessThan(body);
    expect(html.indexOf("Derived")).toBeLessThan(body);
  });

  it("draws a linked item as its proposal's row: number, current title, status", () => {
    expect(html).toContain("#105");
    expect(html).toContain(proposal105.title);
    expect(html).toContain(S.company.proposals.status.ready);
  });

  it("still gives a linked item a pill when the proposals list does not have it", () => {
    // The list failed to load (or has not yet): the row keeps its number and title, and says
    // its status is unknown instead of drawing no pill at all.
    const bare = render(roadmap(), new Map());
    expect(bare).toContain("#105");
    expect(bare).toContain("Right column");
    expect(bare).toContain(`>${S.company.roadmaps.statusUnknown}</span>`);
    expect(bare).toContain(`data-tooltip="${S.company.roadmaps.statusUnknownHint}"`);
    expect(bare).not.toContain(S.company.proposals.status.ready);
    // With the list back, the same row wears the proposal's own status and no fallback.
    expect(html).not.toContain(S.company.roadmaps.statusUnknown);
  });

  it("says an unlinked brief's stage, its approvals, and offers the person's Approve", () => {
    expect(html).toContain(S.company.roadmaps.stage.brief);
    expect(html).toContain("brief b");
    expect(html).toContain(S.company.roadmaps.waiting);
    expect(html).toContain(`>${S.company.roadmaps.approve}</button>`);
  });

  it("shows every employee as a face and a name, never as an id", () => {
    for (const id of ["acme_ceo", "acme_plugin", "acme_web"]) {
      expect(html).toContain(`data-face="${id}"`);
      expect(html).not.toContain(`>${id}<`);
    }
    expect(html).toContain(">Yuki<");
    expect(html).toContain(">Dev (Web)<");
  });

  it("does not draw the record", () => {
    const withRecord = render(roadmap({ record: "moderator notes" } as Partial<OrgRoadmapDetail>));
    expect(withRecord).not.toContain("moderator notes");
  });
});

describe("the body", () => {
  it("renders Markdown: a heading is a heading, not its source", () => {
    const html = renderToStaticMarkup(createElement(RoadmapBody, { text: "## Scope\n\n**bold**" }));
    expect(html).toContain("<h2>Scope</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("## Scope");
  });

  it("makes a proposal reference the shared capsule element and a footnote a note", () => {
    const html = renderToStaticMarkup(
      createElement(RoadmapBody, { text: "See proposal:105 here.[^1]\n\n[^1]: A note." }),
    );
    expect(html).toContain("proposal:105");
    expect(html).not.toContain("[^1]");
    expect(html).toContain("A note.");
    expect(html).toMatch(/<section[^>]*footnotes/);
  });

  it("lays the body straight into the column, with no card around it", () => {
    const html = renderToStaticMarkup(createElement(RoadmapBody, { text: "text" }));
    expect(html).toMatch(/^<div class="md-body[^"]*">/);
    expect(html).not.toMatch(/border|rounded|bg-/);
  });

  it("draws nothing for an empty body", () => {
    expect(renderToStaticMarkup(createElement(RoadmapBody, { text: "  " }))).toBe("");
  });
});

describe("finished proposals in the column", () => {
  const { finishedProposal } = roadmapDetail;

  it("counts merged and rejected as finished, and nothing else", () => {
    expect(finishedProposal("merged")).toBe(true);
    expect(finishedProposal("rejected")).toBe(true);
    for (const s of ["ready", "approved", "drafting", "implementing", undefined]) {
      expect(finishedProposal(s)).toBe(false);
    }
  });

  it("leaves a finished proposal's row out until asked, and offers the toggle with its count", () => {
    const merged = { number: 105, title: "Merged column work", status: "merged" } as ProposalItem;
    const html = render(roadmap(), new Map([[105, merged]]));
    expect(html).not.toContain("Merged column work");
    expect(html).toContain("Sidebar");
    expect(html).toContain(S.company.roadmaps.showFinished(1));
  });

  it("offers no toggle when nothing is finished", () => {
    expect(render(roadmap())).not.toContain(S.company.roadmaps.showFinished(1));
  });
});
