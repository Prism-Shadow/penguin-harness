/**
 * The Activity (features/proposals/activity-model.ts and activity-view.tsx): runs are listed
 * newest first and a next page is merged in without repeats; the filters a person types become
 * the query, empty ones left out; each row says its outcome in its tone, and a refusal or failure
 * says its code and message. The rows render through react-dom/server static markup, with the
 * employee face stood in by a marker carrying the id.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionRunView } from "@prismshadow/penguin-server/api";

vi.mock("../src/features/company/employee-avatar", () => ({
  EmployeeAvatar: (props: { id: string }) => createElement("i", { "data-face": props.id }),
}));
vi.mock("../src/state/locale", () => ({ useLocale: () => ({ locale: "en" }) }));

const { ActivityRowsView } = await import("../src/features/proposals/activity-view");
const { EMPTY_FILTER, RUN_TONE, appendRuns, failureOf, filterOf, runState } =
  await import("../src/features/proposals/activity-model");
const { S } = await import("../src/lib/strings");
const { toneInk } = await import("../src/lib/tone");

const run = (over: Partial<ActionRunView>): ActionRunView => ({
  id: "r1",
  key: "proposal.approve",
  contribution: "company-proposals.action.approve",
  subjectKind: "proposal",
  subject: "proposal:12",
  commit: null,
  params: {},
  by: "agent:acme_dev",
  via: "session",
  sessionId: "s1",
  requestId: null,
  startedAt: "2026-10-03T10:00:00.000Z",
  outcome: "succeeded",
  status: 200,
  code: null,
  message: null,
  result: null,
  hookErrors: [],
  endedAt: "2026-10-03T10:00:00.100Z",
  ...over,
});

describe("paging", () => {
  it("merges the next page in, newest first, each run once", () => {
    const first = [
      run({ id: "c", startedAt: "2026-10-03T10:03:00.000Z" }),
      run({ id: "b", startedAt: "2026-10-03T10:02:00.000Z" }),
    ];
    const next = [
      run({ id: "b", startedAt: "2026-10-03T10:02:00.000Z" }),
      run({ id: "a", startedAt: "2026-10-03T10:01:00.000Z" }),
    ];
    expect(appendRuns(first, next).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("orders runs started at the same instant by id, as the server does", () => {
    const at = "2026-10-03T10:00:00.000Z";
    const out = appendRuns([], [run({ id: "a", startedAt: at }), run({ id: "z", startedAt: at })]);
    expect(out.map((r) => r.id)).toEqual(["z", "a"]);
  });
});

describe("filters", () => {
  it("asks for the subject, the actor and the Action typed, trimmed, and leaves the empty out", () => {
    expect(filterOf(EMPTY_FILTER)).toEqual({});
    expect(
      filterOf({ subject: " proposal:12 ", by: "agent:acme_dev", key: "" }, "2026-10-03|ab"),
    ).toEqual({ subject: "proposal:12", by: "agent:acme_dev", before: "2026-10-03|ab" });
    expect(filterOf({ subject: "", by: "", key: "roadmap.item.approve" })).toEqual({
      key: "roadmap.item.approve",
    });
  });
});

describe("outcomes", () => {
  it("reads a run with no outcome as running, and gives each state its tone", () => {
    expect(runState(run({ outcome: null }))).toBe("running");
    expect(RUN_TONE.running).toBe("busy");
    expect(RUN_TONE.succeeded).toBe("success");
    expect(RUN_TONE.failed).toBe("danger");
    expect(RUN_TONE.refused).toBe("attention");
  });

  it("says why a run did not succeed, and nothing for one that did", () => {
    expect(failureOf(run({}))).toBeNull();
    expect(failureOf(run({ outcome: null }))).toBeNull();
    expect(
      failureOf(
        run({ outcome: "refused", code: "proposal_status", message: "Proposal #12 is merged." }),
      ),
    ).toBe("proposal_status: Proposal #12 is merged.");
  });
});

describe("the rows", () => {
  const names = new Map([["acme_dev", "Dev"]]);
  const html = renderToStaticMarkup(
    createElement(ActivityRowsView, {
      runs: [
        run({
          id: "r2",
          outcome: "refused",
          status: 409,
          code: "proposal_status",
          message: "Proposal #12 is merged.",
        }),
        run({ id: "r1" }),
      ],
      names,
    }),
  );

  it("lists the runs in the order given, each with its key, subject, who and where from", () => {
    expect(html.indexOf('data-run="r2"')).toBeLessThan(html.indexOf('data-run="r1"'));
    expect(html).toContain("proposal.approve");
    expect(html).toContain("proposal:12");
    expect(html).toContain('data-face="acme_dev"');
    expect(html).toContain(S.company.activity.via.session);
  });

  it("says the outcome in its tone, and a refusal's code and message", () => {
    expect(html).toContain(S.company.activity.outcome.refused);
    expect(html).toContain(S.company.activity.outcome.succeeded);
    expect(html).toContain("proposal_status: Proposal #12 is merged.");
    expect(html).toContain(toneInk.attention.split(" ")[0]!);
  });

  it("leaves the subject out of a list fixed to one subject", () => {
    const compact = renderToStaticMarkup(
      createElement(ActivityRowsView, { runs: [run({})], names, compact: true }),
    );
    expect(compact).not.toContain("proposal:12");
  });
});
