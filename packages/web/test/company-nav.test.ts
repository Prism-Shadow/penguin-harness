/**
 * Company mode's navigation (features/company/company-nav.ts) and the work-mode mirrors in
 * localStorage (lib/work-mode.ts).
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
  groupOrganizationsByProject,
  isOrgRoute,
  orgChannelPath,
  orgCreatedPath,
  orgCreatedTarget,
  orgKey,
  orgPagePath,
  parseOrgKey,
  resolveOrgLanding,
} from "../src/features/company/company-nav";
import { DEFAULT_CHANNEL_ID } from "../src/features/company/channel-list";
import {
  LAST_ORG_KEY,
  WORK_MODE_KEY,
  clearLastOrgKey,
  initialLastOrgKey,
  initialWorkMode,
  storeLastOrgKey,
  storeWorkMode,
} from "../src/lib/work-mode";
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
