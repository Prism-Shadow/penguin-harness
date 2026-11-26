/**
 * A page the server contributes is drawn in the iframe it names, the only renderer there is
 * (web-app/contributions.tsx `contributedPagesOf`).
 *
 * - An iframe page joins the table and keeps its renderer, with nothing said on the console.
 * - A page naming the retired `builtin` renderer is not mounted: it stays out of the table, while
 *   an iframe page beside it joins.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { contributedPagesOf } from "../src/web-app/contributions";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";

const page: ContributionsResponse["pages"][number] = {
  id: "plugin.reports",
  from: "plugin",
  key: "reports",
  path: "/reports",
  nav: "main",
  admin: false,
  renderer: { iframe: { src: "/reports/", namespace: "reports" } },
};
const answer = (pages: readonly object[]): ContributionsResponse => ({
  pages: pages as ContributionsResponse["pages"],
  pageRemovals: [],
  agentTabs: [],
  sessionTabs: [],
});

afterEach(() => vi.restoreAllMocks());

describe("a contributed page's renderer", () => {
  it("mounts an iframe page with the renderer it named", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pages = contributedPagesOf([], answer([page]));
    expect(pages.map((p) => p.key)).toEqual(["reports"]);
    expect(pages[0]!.renderer).toEqual({ iframe: { src: "/reports/", namespace: "reports" } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not mount a page naming the retired builtin renderer", () => {
    const pages = contributedPagesOf(
      [],
      answer([
        {
          ...page,
          id: "plugin.legacy",
          key: "legacy",
          path: "/legacy",
          renderer: { builtin: "X" },
        },
        page,
      ]),
    );
    expect(pages.map((p) => p.key)).toEqual(["reports"]);
  });
});
