/**
 * The first input of a room session (lines.ts `cloneBrief`): the moderator is told how the body
 * is shown — a `proposal:<n>` reference becomes a link, a footnote a note — since the body is
 * where those two are written; an employee who does not moderate writes no body and is not told.
 * Its write commands run the roadmap Actions; an approved item's desk line names each approval.
 */
import { describe, expect, it } from "vitest";
import type { Roadmap } from "../src/domain.js";
import { approvalRequestLine, approvedLine, cloneBrief } from "../src/lines.js";

const roadmap: Roadmap = {
  number: 3,
  name: "Company Proposal & Roadmap",
  brief: "",
  channelId: "roadmap_3",
  employees: ["acme_ceo", "acme_dev"],
  explicitModerator: null,
  parent: null,
  parentItem: null,
  status: "discussing",
  record: "",
  body: "",
  items: [],
  clones: [],
  delegations: {},
  createdBy: "user:boss",
  createdAt: "2026-09-29T02:59:46.000Z",
  events: [],
};

const brief = (agentId: string) =>
  cloneBrief({
    orgId: "acme",
    roadmap,
    agentId,
    moderator: "acme_ceo",
    members: ["user:boss", "agent:acme_ceo", "agent:acme_dev"],
    recent: [],
  });

describe("the room session's first input", () => {
  it("tells the moderator how to cite a proposal and add a note in the body", () => {
    const text = brief("acme_ceo");
    expect(text).toContain("`proposal:<n>`");
    expect(text).toContain("footnote");
    expect(text).toContain("[^1]: the note");
  });

  it("does not tell an employee who does not moderate", () => {
    const text = brief("acme_dev");
    expect(text).not.toContain("proposal:<n>");
    expect(text).not.toContain("footnote");
  });
});

const ACTIONS = "$PENGUIN_API_URL/api/projects/$PENGUIN_PROJECT_ID/organizations/acme/actions";

describe("the session's write commands", () => {
  it("run the roadmap Actions with a subject and params, as the session", () => {
    const text = brief("acme_ceo");
    expect(text).toContain(`curl -sS -X POST "${ACTIONS}/roadmap.draft/runs"`);
    expect(text).toContain('"subject": "roadmap:3", "params": {"record": "...", "body": "..."');
    expect(text).toContain(`"${ACTIONS}/roadmap.adopt/runs"`);
    expect(text).toContain('\\"subject\\":\\"roadmap:3\\",\\"params\\":{\\"proposal\\":<n>');
    expect(text).toContain(`"${ACTIONS}/roadmap.establish/runs"`);
    expect(text).toContain('\\"sessionId\\":\\"$PENGUIN_SESSION_ID\\"');
    expect(text).not.toContain("/roadmaps/3/draft");
  });

  it("ask the moderator to approve and link through the item Actions", () => {
    const line = approvalRequestLine({
      orgId: "acme",
      roadmap: { ...roadmap, status: "established" },
      items: [
        {
          key: "a",
          kind: "proposal",
          title: "Ledger",
          brief: "A ledger.",
          owner: "acme_dev",
          cites: [],
          stackedOn: null,
        },
      ],
    });
    expect(line).toContain(`"${ACTIONS}/roadmap.item.approve/runs"`);
    expect(line).toContain('\\"subject\\":\\"item:3/<key>\\"');
    expect(line).toContain(`"${ACTIONS}/roadmap.item.link/runs"`);
  });

  it("name each approval of an approved item, with its role", () => {
    const line = approvedLine({
      roadmap,
      item: {
        key: "a",
        kind: "proposal",
        title: "Ledger",
        brief: "A ledger.",
        owner: "acme_dev",
        cites: [],
        stackedOn: null,
      },
      base: null,
      approvals: [
        { role: "moderator", by: "agent:acme_ceo", at: "t1" },
        { role: "member", by: "user:boss", at: "t2" },
      ],
      proposal: 12,
    });
    expect(line).toContain(
      "is approved: by agent:acme_ceo as moderator (t1) and by user:boss as member (t2).",
    );
  });
});
