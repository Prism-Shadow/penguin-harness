import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contributedPagesOf } from "../src/web-app/contributions";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";

const page = {
  id: "plugin.reports",
  from: "plugin",
  key: "reports",
  path: "/reports",
  renderer: { builtin: "ReportsPage" },
};
const answer = (pages: ContributionsResponse["pages"]): ContributionsResponse => ({
  pages,
  agentTabs: [],
  sessionTabs: [],
});

afterEach(() => vi.restoreAllMocks());

describe("contributed page renderer diagnostics", () => {
  it("reports an unavailable builtin without silently dropping it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(contributedPagesOf([], answer([page]), new Map())).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Missing builtin renderer "ReportsPage" for contributed page "reports" (/reports); skipping page',
    );
  });

  it("keeps registered builtin rendering without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const Component = () => createElement("p", null, "reports");
    const pages = contributedPagesOf([], answer([page]), new Map([["ReportsPage", Component]]));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.Component).toBe(Component);
    expect(renderToStaticMarkup(createElement(pages[0]!.Component))).toBe("<p>reports</p>");
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps iframe pages without looking up a builtin or warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pages = contributedPagesOf(
      [],
      answer([{ ...page, renderer: { iframe: { src: "/reports/", namespace: "reports" } } }]),
      new Map(),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]!.renderer).toEqual({ iframe: { src: "/reports/", namespace: "reports" } });
    expect(warn).not.toHaveBeenCalled();
  });
});
