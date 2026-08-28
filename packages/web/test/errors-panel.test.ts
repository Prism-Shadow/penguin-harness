/**
 * The cost center's error table and its clear action.
 *
 * Two properties a type checker cannot see. The action is offered only where it can succeed —
 * the route is owner-only, so showing it to a member would be an affordance whose only outcome
 * is a 403 — and only while there are rows to take.
 *
 * The other is the confirmation's wording, which is the whole safety mechanism here: the delete
 * is scoped to the filter on screen, so a dialog that named the Project's whole history, or
 * only the visible page, would send someone into an irreversible action describing the wrong
 * set. That sentence is a pure function for exactly this reason — this package's vitest runs in
 * `node`, deliberately, so an opened dialog is not something a test can read.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageErrorItem, UsageErrors } from "@prismshadow/penguin-server/api";
import { ErrorsPanel, errorsClearScopeText } from "../src/features/usage/errors-panel";
import type { ErrorsFilters } from "../src/features/usage/errors-panel";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

const item = (code: string): UsageErrorItem => ({
  ts: "2026-08-27T10:00:00.000Z",
  source: "http",
  code,
  kind: "unexpected",
  message: `${code} went wrong`,
});

function errorsOf(items: UsageErrorItem[], clearable = items.length): UsageErrors {
  return {
    total: items.length,
    clearable,
    unexpected: items.length,
    topCode: null,
    recent: items,
  };
}

const FILTERS: ErrorsFilters = { from: "2026-08-01", to: "2026-08-27" };

function render(
  opts: {
    items?: UsageErrorItem[];
    clearable?: number;
    canClear?: boolean;
    filters?: ErrorsFilters;
  } = {},
): string {
  const items = opts.items ?? [item("internal")];
  return renderToStaticMarkup(
    createElement(ErrorsPanel, {
      errors: errorsOf(items, opts.clearable ?? items.length),
      projectId: "p1",
      filters: opts.filters ?? FILTERS,
      canClear: opts.canClear ?? true,
      onCleared: () => {},
    }),
  );
}

describe("ErrorsPanel clear action", () => {
  it("is offered to the Project owner only", () => {
    expect(render({ canClear: true })).toContain(S.usage.errorsClear);
    // A member reads the panel; the route refuses the delete, so the button is not there to
    // promise otherwise.
    expect(render({ canClear: false })).not.toContain(S.usage.errorsClear);
  });

  it("is absent while the filtered table is empty", () => {
    const empty = render({ items: [] });
    expect(empty).toContain(S.usage.errorsEmpty);
    expect(empty).not.toContain(S.usage.errorsClear);
  });

  it("is absent when every row in range is one no Project-scoped clear can take", () => {
    // An admin's read includes unattributed rows (a login failure, a process crash); the delete
    // never does. A window holding only those has rows on screen and nothing to clear, so the
    // action must not be offered — it could only report "deleted 0".
    expect(render({ items: [item("uncaught_exception")], clearable: 0 })).not.toContain(
      S.usage.errorsClear,
    );
  });

  it("is absent while a date bound is blank: the sentence could not describe that delete", () => {
    // A cleared date input sends no bound, which the route reads as unbounded on that side —
    // wider than anything the confirmation's "records outside that range are kept" can promise.
    expect(render({ filters: { from: "", to: "2026-08-27" } })).not.toContain(S.usage.errorsClear);
  });

  it("keeps the pager independent of it: rows but one page shows the action alone", () => {
    const onePage = render({ items: [item("internal")] });
    expect(onePage).toContain(S.usage.errorsClear);
    expect(onePage).not.toContain(S.usage.errorsOlder);
  });
});

describe("errorsClearScopeText", () => {
  for (const [locale, dict] of Object.entries({ zh, en })) {
    it(`${locale}: names the date range, and the Agent when one is selected`, () => {
      setActiveStrings(dict);
      const ranged = errorsClearScopeText(FILTERS, 12);
      expect(ranged).toContain("2026-08-01");
      expect(ranged).toContain("2026-08-27");
      expect(ranged).toContain("12");
      // No Agent filter: the sentence must not claim one, or it describes a narrower delete
      // than the one about to run.
      expect(ranged).not.toContain("agent-7");

      const perAgent = errorsClearScopeText({ ...FILTERS, agentId: "agent-7" }, 3);
      expect(perAgent).toContain("agent-7");
      expect(perAgent).toContain("2026-08-01");
      expect(perAgent).toContain("3");
    });
  }

  it("an empty agentId is no filter at all (the panel's own spelling of 'all agents')", () => {
    expect(errorsClearScopeText({ ...FILTERS, agentId: "" }, 4)).toBe(
      errorsClearScopeText(FILTERS, 4),
    );
  });
});
