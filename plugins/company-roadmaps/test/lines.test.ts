/**
 * The first input of a room session (lines.ts `cloneBrief`): the moderator is told how the body
 * is shown — a `proposal:<n>` reference becomes a link, a footnote a note — since the body is
 * where those two are written; an employee who does not moderate writes no body and is not told.
 */
import { describe, expect, it } from "vitest";
import type { Roadmap } from "../src/ledger.js";
import { cloneBrief } from "../src/lines.js";

const roadmap: Roadmap = {
  number: 3,
  name: "Company Proposal & Roadmap",
  brief: "",
  channelId: "roadmap_3",
  employees: ["acme_ceo", "acme_dev"],
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
