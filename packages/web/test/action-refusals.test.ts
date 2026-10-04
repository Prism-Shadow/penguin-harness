/**
 * Why a proposal's action button is disabled (features/proposals/action-refusals.tsx): the
 * actions listing's answers split into the keys allowed and the refusal of each one that is
 * not, a refusal said as its message then its code, and the notes under the action bar — one
 * line per refused button, each carrying the id its button names as its description.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionView } from "@prismshadow/penguin-server/api";
import {
  RefusalNotes,
  actionAnswers,
  refusalNoteId,
  refusalText,
} from "../src/features/proposals/action-refusals";

const view = (key: string, over: Partial<ActionView> = {}): ActionView => ({
  key,
  contribution: `company-proposals.action.${key}`,
  subjects: ["proposal"],
  params: {},
  description: "",
  builtin: true,
  ...over,
});

const guardSaysNo = {
  status: 403,
  code: "qa_does_not_approve",
  message: "QA does not approve in this company.",
};

describe("the guards' answers on a subject", () => {
  it("splits the listing into the keys allowed and the refusal of each one refused", () => {
    const answers = actionAnswers([
      view("proposal.reject", { allowed: true }),
      view("proposal.approve", { allowed: false, refusal: guardSaysNo }),
      // Not asked about (no subject): neither allowed nor refused.
      view("proposal.discuss"),
    ]);
    expect([...answers.allowed]).toEqual(["proposal.reject"]);
    expect([...answers.refusals]).toEqual([["proposal.approve", guardSaysNo]]);
  });

  it("says a refusal as its message and code, or the code alone", () => {
    expect(refusalText(guardSaysNo)).toBe(
      "QA does not approve in this company. (qa_does_not_approve)",
    );
    expect(refusalText({ status: 409, code: "action_ambiguous", message: " " })).toBe(
      "action_ambiguous",
    );
  });
});

describe("the notes under the action bar", () => {
  it("draws one line per refused button, under the id its button is described by", () => {
    const html = renderToStaticMarkup(
      createElement(RefusalNotes, {
        scope: "proposal-actions",
        notes: [{ key: "proposal.approve", label: "Approve", refusal: guardSaysNo }],
      }),
    );
    const id = refusalNoteId("proposal-actions", "proposal.approve");
    expect(id).toBe("proposal-actions-refusal-proposal-approve");
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Approve");
    expect(html).toContain("QA does not approve in this company. (qa_does_not_approve)");
  });

  it("draws nothing when no button is refused", () => {
    expect(renderToStaticMarkup(createElement(RefusalNotes, { scope: "x", notes: [] }))).toBe("");
  });
});
