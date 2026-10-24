/**
 * Which server-contributed pages mount beside the app's own (web-app/page-table.ts
 * `contributedPages`). The app's own pages are module contributions; web-root.test.ts covers those.
 *
 * - A server page whose renderer this build carries is taken.
 * - A server page with an unknown builtin renderer is skipped, and a local page wins over a
 *   same-key server one.
 * - An iframe renderer needs no registry entry.
 */
import { describe, expect, it } from "vitest";
import { contributedPages, orgPagesOf } from "../src/web-app/page-table";

/** The app's own pages, as far as the merge reads them: their keys. */
const LOCAL = [{ key: "agents" }, { key: "usage" }];

describe("contributedPages", () => {
  const known = new Set(["AgentsPage", "UsagePage"]);

  it("takes a server page whose renderer this build carries", () => {
    const merged = contributedPages(
      LOCAL,
      [
        {
          id: "x.reports",
          key: "reports",
          path: "/reports",
          nav: "main",
          renderer: { builtin: "UsagePage" },
        },
      ],
      known,
    );
    expect(merged).toMatchObject([
      {
        key: "reports",
        path: "/reports",
        nav: "main",
        admin: false,
        released: true,
      },
    ]);
  });

  it("keeps a company-mode page's nav value, which the router mounts under the organization layout", () => {
    const merged = contributedPages(
      LOCAL,
      [
        {
          key: "org-proposals",
          path: "proposals/:number?",
          nav: "org",
          renderer: { builtin: "OrgProposalsPage" },
        },
      ],
      new Set(["OrgProposalsPage"]),
    );
    expect(orgPagesOf(merged)).toMatchObject([
      { key: "org-proposals", path: "proposals/:number?" },
    ]);
  });

  it("skips a page with an unknown builtin renderer, and keeps a local page over a same-key remote one", () => {
    const merged = contributedPages(
      LOCAL,
      [
        { key: "later", path: "/later", renderer: { builtin: "NotBuiltHere" } },
        { key: "agents", path: "/elsewhere", renderer: { builtin: "AgentsPage" } },
      ],
      known,
    );
    expect(merged).toEqual([]);
  });

  it("an iframe renderer needs no registry entry", () => {
    const merged = contributedPages(
      [],
      [
        {
          key: "wf",
          path: "/wf",
          renderer: { iframe: { src: "/workflow/a/wf/", namespace: "wf" } },
        },
      ],
      known,
    );
    expect(merged).toHaveLength(1);
  });
});
