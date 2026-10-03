/**
 * How server-contributed pages fold in beside the app's own (web-app/page-table.ts `mergePages`).
 * The app's own pages are module contributions now; web-root.test.ts covers those.
 *
 * - A server page whose renderer this build carries is appended after the local ones.
 * - A server page with an unknown builtin renderer is skipped, and a local page wins over a
 *   same-key server one.
 * - An iframe renderer needs no registry entry.
 */
import { describe, expect, it } from "vitest";
import { mergePages, orgPagesOf } from "../src/web-app/page-table";
import type { PageEntry } from "../src/web-app/page-table";

/** Local pages in the server's shape, standing in for the app's own. */
const LOCAL: PageEntry[] = [
  {
    id: "web.agents",
    key: "agents",
    path: "/agents",
    nav: "main",
    admin: false,
    released: true,
    renderer: { builtin: "AgentsPage" },
  },
  {
    id: "web.usage",
    key: "usage",
    path: "/usage",
    nav: "main",
    admin: false,
    released: true,
    renderer: { builtin: "UsagePage" },
  },
];

describe("mergePages", () => {
  const known = new Set(["AgentsPage", "UsagePage"]);

  it("adds a server page whose renderer this build carries, after the local ones", () => {
    const merged = mergePages(
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
    expect(merged.at(-1)).toMatchObject({
      key: "reports",
      path: "/reports",
      nav: "main",
      admin: false,
      released: true,
    });
  });

  it("keeps a company-mode page's nav value, which the router mounts under the organization layout", () => {
    const merged = mergePages(
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
    expect(orgPagesOf(LOCAL)).toEqual([]);
  });

  it("skips a page with an unknown builtin renderer, and keeps a local page over a same-key remote one", () => {
    const merged = mergePages(
      LOCAL,
      [
        { key: "later", path: "/later", renderer: { builtin: "NotBuiltHere" } },
        { key: "agents", path: "/elsewhere", renderer: { builtin: "AgentsPage" } },
      ],
      known,
    );
    expect(merged.map((p) => p.key)).toEqual(LOCAL.map((p) => p.key));
  });

  it("an iframe renderer needs no registry entry", () => {
    const merged = mergePages(
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
