/**
 * The web app's page manifest (src/module.json) and how server contributions fold in.
 */
import { describe, expect, it } from "vitest";
import { NAV_PAGE_KEYS, PAGES, mergePages, navPagesFor } from "../src/lib/pages";
import { NAV_GROUP_KEYS } from "../src/lib/nav-group-collapse";
import { zh } from "../src/lib/strings";
import { NAV_ICONS } from "../src/components/ui/icons";

describe("the page manifest", () => {
  it("names only keys the nav strings and icons are typed for", () => {
    for (const key of NAV_PAGE_KEYS) {
      expect(zh.nav).toHaveProperty(key);
      expect(NAV_ICONS).toHaveProperty(key);
    }
    expect(NAV_GROUP_KEYS).toEqual(NAV_PAGE_KEYS);
  });

  it("every page has a unique id, key and path, and a renderer", () => {
    const ids = new Set(PAGES.map((p) => p.id));
    expect(ids.size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.key)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
    for (const page of PAGES)
      expect("builtin" in page.renderer || "iframe" in page.renderer).toBe(true);
  });

  it("the nav a member sees drops admin-only and unreleased pages", () => {
    const admin = navPagesFor(true).map((p) => p.key);
    const member = navPagesFor(false).map((p) => p.key);
    expect(admin).toContain("machines"); // released, and admin-only
    expect(member).not.toContain("machines");
    expect(member.every((key) => admin.includes(key))).toBe(true);
    for (const page of PAGES.filter((p) => p.nav === "main" && p.admin))
      expect(member).not.toContain(page.key);
  });
});

describe("mergePages", () => {
  const known = new Set(["AgentsPage", "UsagePage"]);

  it("adds a server page whose renderer this build carries, after the local ones", () => {
    const merged = mergePages(
      PAGES,
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

  it("skips a page with an unknown builtin renderer, and keeps a local page over a same-key remote one", () => {
    const merged = mergePages(
      PAGES,
      [
        { key: "later", path: "/later", renderer: { builtin: "NotBuiltHere" } },
        { key: "agents", path: "/elsewhere", renderer: { builtin: "AgentsPage" } },
      ],
      known,
    );
    expect(merged.map((p) => p.key)).toEqual(PAGES.map((p) => p.key));
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
