/**
 * Company mode's navigation (features/company/company-nav.ts) and the work-mode mirrors in
 * localStorage (features/company/work-mode.ts).
 *
 * - An organization key is `<projectId>/<orgId>` and parses back; anything but two non-empty
 *   segments is refused.
 * - Page and channel paths live under `/org`, with the ids encoded.
 * - A new organization opens in the CEO's desk when it has one, else on its overview, and the
 *   shell becomes current at its plain-id key whatever the path escapes.
 * - Organization routes are told apart from the shared chat route.
 * - `/org` lands on the organization last opened while it exists, else the current Project's
 *   first, else the first anywhere, and nowhere without any.
 * - The switcher groups organizations in the Project list's order, dropping empty Projects.
 * - The mode defaults to development, only an explicit company switches it; only a
 *   well-formed last organization key is kept, and it can be forgotten outright; a throwing
 *   storage degrades to the defaults.
 */
import { describe, expect, it } from "vitest";
import {
  COMPANY_NAV_KEYS,
  ORG_PAGE_RENDERERS,
  groupOrganizationsByProject,
  orgPageRows,
  orgPageSegment,
  orgProposalPath,
  isOrgRoute,
  homePath,
  conversationMode,
  orgChannelPath,
  orgCreatedPath,
  orgCreatedTarget,
  orgKey,
  orgPagePath,
  parseOrgKey,
  resolveOrgLanding,
} from "../src/features/company/company-nav";
import { DEFAULT_CHANNEL_ID } from "../src/features/company/channel-list";
import { COMPANY_NAV_ICONS, ORG_PAGE_ICONS } from "../src/features/company/company-nav-icons";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  LAST_ORG_KEY,
  WORK_MODE_KEY,
  clearLastOrgKey,
  initialLastOrgKey,
  initialWorkMode,
  storeLastOrgKey,
  storeWorkMode,
} from "../src/features/company/work-mode";
import { blockedStorage, memoryStorage } from "./helpers/storage";

describe("org keys and paths", () => {
  it("round-trips a key through parseOrgKey", () => {
    expect(orgKey("p1", "acme")).toBe("p1/acme");
    expect(parseOrgKey("p1/acme")).toEqual({ projectId: "p1", orgId: "acme" });
  });

  it("rejects anything that is not exactly two non-empty segments", () => {
    for (const raw of [null, undefined, "", "p1", "/acme", "p1/", "p1/acme/extra"]) {
      expect(parseOrgKey(raw)).toBeNull();
    }
  });

  it("builds page paths under the /org prefix, encoding the ids", () => {
    expect(orgPagePath("p1", "acme", "tickets")).toBe("/org/p1/acme/tickets");
    expect(orgPagePath("alice-proj", "a b", "overview")).toBe("/org/alice-proj/a%20b/overview");
    expect(orgPagePath("p1", "acme", "handbook")).toBe("/org/p1/acme/handbook");
  });

  it("builds a channel path with the channel as its own segment", () => {
    expect(orgChannelPath("p1", "acme", DEFAULT_CHANNEL_ID)).toBe(
      "/org/p1/acme/channels/default_channel",
    );
    expect(orgChannelPath("p1", "acme", "site")).toBe("/org/p1/acme/channels/site");
    expect(orgChannelPath("alice-proj", "a b", "site")).toBe("/org/alice-proj/a%20b/channels/site");
  });

  it("lands a newly created organization in the CEO's desk, else on its overview", () => {
    expect(orgCreatedPath({ projectId: "p1", orgId: "acme", ceoDeskSessionId: "s-1" })).toBe(
      "/chat/s-1",
    );
    expect(orgCreatedPath({ projectId: "p1", orgId: "acme" })).toBe("/org/p1/acme/overview");
  });

  // The desk session is NOT one of the organization's own routes, so nothing on the way there
  // would tell the shell which organization it is now inside: the key travels with the path.
  it("names the organization the shell becomes current at beside the path it opens", () => {
    expect(orgCreatedTarget({ projectId: "p1", orgId: "acme", ceoDeskSessionId: "s-1" })).toEqual({
      key: "p1/acme",
      path: "/chat/s-1",
    });
    expect(orgCreatedTarget({ projectId: "p1", orgId: "acme" })).toEqual({
      key: "p1/acme",
      path: "/org/p1/acme/overview",
    });
  });

  // The key is the shell's own grammar, not the path's: a Project or an organization whose id
  // needs escaping in a URL is still keyed by its plain ids, which is what parseOrgKey reads
  // back and what the organization list is searched by.
  it("keys the created organization by its plain ids while the path escapes them", () => {
    const target = orgCreatedTarget({ projectId: "alice proj", orgId: "acme" });
    expect(target.key).toBe("alice proj/acme");
    expect(parseOrgKey(target.key)).toEqual({ projectId: "alice proj", orgId: "acme" });
    expect(target.path).toBe("/org/alice%20proj/acme/overview");
  });

  it("tells organization routes from the shared chat route", () => {
    expect(isOrgRoute("/org")).toBe(true);
    expect(isOrgRoute("/org/p1/acme/overview")).toBe(true);
    expect(isOrgRoute("/org/p1/acme/channels/site")).toBe(true);
    expect(isOrgRoute("/organizations")).toBe(false);
    expect(isOrgRoute("/chat/abc")).toBe(false);
  });
});

describe("which mode a route stands in", () => {
  it("lands a route that names no page on the home of the mode the shell is in", () => {
    // `/` is where a sign-in and the desktop shell's start arrive: in company mode it must not
    // be the conversation page, which would sit inside the company sidebar.
    expect(homePath("company")).toBe("/org");
    expect(homePath("dev")).toBe("/chat");
  });

  it("gives the new-chat draft and the user's own conversations to development mode", () => {
    expect(conversationMode(true, null)).toBe("dev");
    expect(conversationMode(false, false)).toBe("dev");
  });

  it("claims nothing for a desk or ticket Session, nor for one not resolved yet", () => {
    expect(conversationMode(false, true)).toBeNull();
    expect(conversationMode(false, null)).toBeNull();
  });
});

describe("resolveOrgLanding", () => {
  const orgs = [
    { projectId: "p1", orgId: "a" },
    { projectId: "p2", orgId: "b" },
    { projectId: "p2", orgId: "c" },
  ];

  it("returns the organization last opened when it still exists", () => {
    expect(resolveOrgLanding("p2/c", orgs, "p1")).toEqual({ projectId: "p2", orgId: "c" });
  });

  it("falls back to the current Project's first organization, then to the first anywhere", () => {
    expect(resolveOrgLanding("p9/gone", orgs, "p2")).toEqual({ projectId: "p2", orgId: "b" });
    expect(resolveOrgLanding(null, orgs, "p3")).toEqual({ projectId: "p1", orgId: "a" });
    expect(resolveOrgLanding(null, orgs, null)).toEqual({ projectId: "p1", orgId: "a" });
  });

  it("is null with no organization at all — the empty landing's cue", () => {
    expect(resolveOrgLanding("p1/a", [], "p1")).toBeNull();
  });
});

describe("groupOrganizationsByProject", () => {
  it("groups in the Project list's order and drops Projects with no organization", () => {
    const orgs = [
      { projectId: "p2", orgId: "b" },
      { projectId: "p1", orgId: "a" },
      { projectId: "p2", orgId: "c" },
      { projectId: "stale", orgId: "z" },
    ];
    expect(groupOrganizationsByProject(orgs, ["p1", "p2", "p3"])).toEqual([
      { projectId: "p1", organizations: [{ projectId: "p1", orgId: "a" }] },
      {
        projectId: "p2",
        organizations: [
          { projectId: "p2", orgId: "b" },
          { projectId: "p2", orgId: "c" },
        ],
      },
    ]);
  });
});

describe("work-mode storage mirrors", () => {
  it("defaults to development with nothing stored, and only an explicit company switches", () => {
    const s = memoryStorage();
    expect(initialWorkMode(s)).toBe("dev");
    storeWorkMode("company", s);
    expect(s.map.get(WORK_MODE_KEY)).toBe("company");
    expect(initialWorkMode(s)).toBe("company");
    s.map.set(WORK_MODE_KEY, "COMPANY");
    expect(initialWorkMode(s)).toBe("dev");
  });

  it("keeps only a well-formed last organization key", () => {
    const s = memoryStorage();
    expect(initialLastOrgKey(s)).toBeNull();
    storeLastOrgKey("p1/acme", s);
    expect(s.map.get(LAST_ORG_KEY)).toBe("p1/acme");
    expect(initialLastOrgKey(s)).toBe("p1/acme");
    s.map.set(LAST_ORG_KEY, "garbage");
    expect(initialLastOrgKey(s)).toBeNull();
  });

  // The organization it named was deleted: the mirror is dropped, not overwritten, so the
  // next reload starts with no remembered organization at all.
  it("forgets the last organization key outright", () => {
    const s = memoryStorage();
    storeLastOrgKey("p1/acme", s);
    clearLastOrgKey(s);
    expect(s.map.has(LAST_ORG_KEY)).toBe(false);
    expect(initialLastOrgKey(s)).toBeNull();
  });

  it("throwing storage degrades to the defaults instead of escaping", () => {
    const broken = blockedStorage();
    expect(() => storeWorkMode("company", broken)).not.toThrow();
    expect(() => clearLastOrgKey(broken)).not.toThrow();
    expect(initialWorkMode(broken)).toBe("dev");
    expect(initialLastOrgKey(broken)).toBeNull();
  });
});

describe("contributed company-mode pages", () => {
  const page = (
    over: Partial<{
      key: string;
      path: string;
      nav: string;
      renderer: { builtin: string } | { iframe: unknown };
    }> = {},
  ) => ({
    key: "org-proposals",
    path: "proposals/:number?",
    nav: "org",
    renderer: { builtin: "OrgProposalsPage" as const },
    ...over,
  });

  it("has a zh label, an en label and a glyph for every renderer it knows a row for", () => {
    for (const renderer of Object.keys(ORG_PAGE_RENDERERS) as Array<
      keyof typeof ORG_PAGE_RENDERERS
    >) {
      const label = ORG_PAGE_RENDERERS[renderer].label;
      expect(typeof zh.nav.org[label]).toBe("string");
      expect(typeof en.nav.org[label]).toBe("string");
      expect(ORG_PAGE_ICONS[renderer]).toMatch(/^M/);
    }
  });

  it("turns a contributed org page into a row leading to its first segment, disabled without an organization", () => {
    expect(orgPageSegment("proposals/:number?")).toBe("proposals");
    expect(orgPageSegment("/reports")).toBe("reports");
    expect(orgPageRows([page()], { projectId: "p 1", orgId: "acme" })).toEqual([
      { key: "org-proposals", renderer: "OrgProposalsPage", to: "/org/p%201/acme/proposals" },
    ]);
    expect(orgPageRows([page()], null)).toEqual([
      { key: "org-proposals", renderer: "OrgProposalsPage", to: null },
    ]);
  });

  it("skips pages outside the org nav, iframe pages, and renderers this build has no row for", () => {
    expect(
      orgPageRows(
        [
          page({ nav: "main" }),
          page({ key: "x", renderer: { iframe: { src: "x" } } }),
          page({ key: "y", renderer: { builtin: "SomethingElse" } }),
        ],
        { projectId: "p", orgId: "o" },
      ),
    ).toEqual([]);
  });

  it("draws no org-nav row for the roadmaps page — its roadmaps are the sidebar's own section, below the channels", () => {
    const roadmaps = page({
      key: "roadmaps",
      path: "roadmaps/:number?",
      renderer: { iframe: { src: "/api/company-roadmaps/page", namespace: "company-roadmaps" } },
    });
    const org = { projectId: "p", orgId: "acme" };
    // Whichever order the plugins are listed in, the only contributed row is Proposals.
    for (const listed of [
      [page(), roadmaps],
      [roadmaps, page()],
    ]) {
      expect(orgPageRows(listed, org).map((row) => row.key)).toEqual(["org-proposals"]);
    }
    expect(Object.keys(ORG_PAGE_RENDERERS)).toEqual(["OrgProposalsPage"]);
    expect("roadmaps" in zh.nav.org).toBe(false);
    expect("roadmaps" in en.nav.org).toBe(false);
    // An iframe page keyed like a builtin renderer still draws nothing.
    expect(
      orgPageRows([page({ key: "OrgProposalsPage", renderer: { iframe: { src: "x" } } })], org),
    ).toEqual([]);
    // Two pages with one renderer keep the order they were contributed in.
    expect(
      orgPageRows([page({ key: "b" }), roadmaps, page({ key: "a" })], org).map((row) => row.key),
    ).toEqual(["b", "a"]);
  });

  it("addresses one proposal by its number under the proposals page", () => {
    expect(orgProposalPath("p", "acme", 12)).toBe("/org/p/acme/proposals/12");
  });
});
