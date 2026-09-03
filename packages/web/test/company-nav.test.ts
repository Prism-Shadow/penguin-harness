/**
 * company-nav.ts and work-mode.ts unit tests: the company-mode nav manifest (the six pages
 * in rendered order, each with a zh label, an en label and a glyph — the sidebar, the rail
 * and the router all derive their rows from it), the `<projectId>/<orgId>` key, the
 * `/org/:projectId/:orgId/<page>` and `…/channels/:channelId` grammars, where `/org` lands
 * without an organization, the switcher's grouping by Project, and the localStorage mirrors
 * of the mode and the last organization (injectable storage, degrading to the defaults on
 * anything unexpected).
 */
import { describe, expect, it } from "vitest";
import {
  COMPANY_NAV_KEYS,
  groupOrganizationsByProject,
  isOrgRoute,
  orgChannelPath,
  orgKey,
  orgPagePath,
  parseOrgKey,
  resolveOrgLanding,
} from "../src/features/company/company-nav";
import { DEFAULT_CHANNEL_ID } from "../src/features/company/channel-list";
import { COMPANY_NAV_ICONS } from "../src/features/company/company-nav-icons";
import {
  LAST_ORG_KEY,
  WORK_MODE_KEY,
  initialLastOrgKey,
  initialWorkMode,
  storeLastOrgKey,
  storeWorkMode,
} from "../src/lib/work-mode";
import type { WorkModeStorage } from "../src/lib/work-mode";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

function memStorage(): WorkModeStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("COMPANY_NAV_KEYS", () => {
  it("lists the six organization pages in the spec's order, channels not among them", () => {
    expect([...COMPANY_NAV_KEYS]).toEqual([
      "overview",
      "chart",
      "calendar",
      "tickets",
      "finance",
      "handbook",
    ]);
    // Channels are the sidebar's own list, the way conversations are in development mode.
    expect(COMPANY_NAV_KEYS).not.toContain("chat");
    expect(COMPANY_NAV_KEYS).not.toContain("channels");
  });

  it("every entry has the spec's zh and en names and a glyph", () => {
    // The bilingual table of the prototype spec, verbatim.
    const expected = {
      overview: ["概览", "Overview"],
      chart: ["组织图", "Org Chart"],
      calendar: ["日历", "Calendar"],
      tickets: ["工单", "Tickets"],
      finance: ["财务", "Finance"],
      handbook: ["手册", "Handbook"],
    } as const;
    for (const key of COMPANY_NAV_KEYS) {
      expect(zh.nav.org[key]).toBe(expected[key][0]);
      expect(en.nav.org[key]).toBe(expected[key][1]);
      expect(COMPANY_NAV_ICONS[key]).toBeTruthy();
    }
  });

  it("the mode switch's two options exist in both languages and differ", () => {
    for (const dict of [zh, en]) {
      expect(dict.company.modeDev).toBeTruthy();
      expect(dict.company.modeCompany).toBeTruthy();
      expect(dict.company.modeDev).not.toBe(dict.company.modeCompany);
    }
  });
});

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
    const s = memStorage();
    expect(initialWorkMode(s)).toBe("dev");
    storeWorkMode("company", s);
    expect(s.map.get(WORK_MODE_KEY)).toBe("company");
    expect(initialWorkMode(s)).toBe("company");
    s.map.set(WORK_MODE_KEY, "COMPANY");
    expect(initialWorkMode(s)).toBe("dev");
  });

  it("keeps only a well-formed last organization key", () => {
    const s = memStorage();
    expect(initialLastOrgKey(s)).toBeNull();
    storeLastOrgKey("p1/acme", s);
    expect(s.map.get(LAST_ORG_KEY)).toBe("p1/acme");
    expect(initialLastOrgKey(s)).toBe("p1/acme");
    s.map.set(LAST_ORG_KEY, "garbage");
    expect(initialLastOrgKey(s)).toBeNull();
  });

  it("throwing storage degrades to the defaults instead of escaping", () => {
    const broken: WorkModeStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => storeWorkMode("company", broken)).not.toThrow();
    expect(initialWorkMode(broken)).toBe("dev");
    expect(initialLastOrgKey(broken)).toBeNull();
  });
});
