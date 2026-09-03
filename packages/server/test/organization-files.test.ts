/**
 * Organization file formats (src/organization): every intent and fact file round-trips
 * through its serializer and parser, hand-edit tolerance is the same set of rules the API
 * writes under, and the timezone arithmetic behind budget periods and message days is exact.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractMentionTokens,
  parseCalendarEvent,
  parseChannelConfig,
  parseChannelMessageLine,
  parseDesks,
  parseOrgChart,
  parseOrgConfig,
  parseProgressLine,
  parseTicket,
  progressLine,
  serializeCalendarEvent,
  serializeChannelConfig,
  serializeChannelMessageLine,
  serializeDesks,
  serializeOrgChart,
  serializeOrgConfig,
  serializeTicket,
  slugify,
  subordinatesOf,
  ancestorsOf,
} from "../src/organization/files.js";
import type { ChannelConfig, OrgChart, OrgConfig, TicketDoc } from "../src/organization/files.js";
import {
  formatPrincipal,
  parsePrincipal,
  splitPrincipalList,
} from "../src/organization/principal.js";
import {
  DEFAULT_CHANNEL_ID,
  channelConfigPath,
  channelDayPath,
  isChannelId,
  ticketMonth,
  ticketPath,
} from "../src/organization/paths.js";
import {
  zonedDate,
  zonedMonthRange,
  zonedOffsetMinutes,
  zonedPeriodRange,
} from "../src/organization/zoned.js";

const config: OrgConfig = {
  name: "Acme",
  mission: "Build a marketplace",
  status: "active",
  timezone: "Asia/Shanghai",
  approvalMode: "allow-all",
  mentionChainLimit: 3,
  budgetWarnRatio: 0.8,
  budgetPauseRatio: 1,
  createdBy: "alice",
};

const chart: OrgChart = {
  employees: [
    { agentId: "acme_ceo", title: "CEO", reportsTo: null, workspace: ".", budget: 200 },
    { agentId: "acme_hr", title: "HR", reportsTo: "acme_ceo", workspace: "people", budget: 30 },
    {
      agentId: "acme_dev",
      title: "Developer",
      reportsTo: "acme_hr",
      duties: "Build the site",
      workspace: "site",
      model: { provider: "custom", modelId: "m-dev" },
    },
  ],
};

describe("org_config.toml", () => {
  it("round-trips and applies defaults for omitted fields", () => {
    const parsed = parseOrgConfig(serializeOrgConfig(config));
    expect(parsed).toEqual({ ok: true, value: config });
    const minimal = parseOrgConfig('name = "Acme"\nmission = "x"\ncreated_by = "alice"\n');
    expect(minimal.ok && minimal.value.status).toBe("active");
    expect(minimal.ok && minimal.value.mentionChainLimit).toBe(3);
    expect(minimal.ok && minimal.value.timezone).toBe("UTC");
  });

  it("rejects a bad status, timezone or ratio", () => {
    expect(parseOrgConfig('name = "A"\nmission = ""\ncreated_by = "u"\nstatus = "off"\n').ok).toBe(
      false,
    );
    expect(
      parseOrgConfig('name = "A"\nmission = ""\ncreated_by = "u"\ntimezone = "Mars/Olympus"\n').ok,
    ).toBe(false);
    expect(
      parseOrgConfig('name = "A"\nmission = ""\ncreated_by = "u"\nbudget_warn_ratio = 0\n').ok,
    ).toBe(false);
    expect(parseOrgConfig("name = [\n").ok).toBe(false);
  });
});

describe("org_chart.yaml", () => {
  it("round-trips the tree with budgets and models", () => {
    const parsed = parseOrgChart(serializeOrgChart(chart), "acme");
    expect(parsed).toEqual({ ok: true, value: chart });
  });

  it("requires exactly one root and that it is the CEO", () => {
    const noRoot =
      "employees:\n  - agent_id: acme_ceo\n    title: CEO\n    reports_to: acme_hr\n  - agent_id: acme_hr\n    title: HR\n    reports_to: acme_ceo\n";
    expect(parseOrgChart(noRoot, "acme").ok).toBe(false);
    const wrongRoot =
      "employees:\n  - agent_id: acme_boss\n    title: Boss\n    reports_to: null\n";
    const r = parseOrgChart(wrongRoot, "acme");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("acme_ceo");
  });

  it("rejects unknown managers, duplicates and cycles", () => {
    const unknown =
      "employees:\n  - agent_id: acme_ceo\n    title: CEO\n    reports_to: null\n  - agent_id: acme_hr\n    title: HR\n    reports_to: nobody\n";
    expect(parseOrgChart(unknown, "acme").ok).toBe(false);
    const dup =
      "employees:\n  - agent_id: acme_ceo\n    title: CEO\n    reports_to: null\n  - agent_id: acme_ceo\n    title: CEO\n    reports_to: null\n";
    expect(parseOrgChart(dup, "acme").ok).toBe(false);
    const cycle =
      "employees:\n  - agent_id: acme_ceo\n    title: CEO\n    reports_to: null\n  - agent_id: a\n    title: A\n    reports_to: b\n  - agent_id: b\n    title: B\n    reports_to: a\n";
    expect(parseOrgChart(cycle, "acme").ok).toBe(false);
  });

  it("walks the reporting line both ways", () => {
    expect(subordinatesOf(chart, "acme_ceo")).toEqual(["acme_hr", "acme_dev"]);
    expect(subordinatesOf(chart, "acme_dev")).toEqual([]);
    expect(ancestorsOf(chart, "acme_dev")).toEqual(["acme_hr", "acme_ceo"]);
    expect(ancestorsOf(chart, "acme_ceo")).toEqual([]);
  });
});

describe("desks.toml", () => {
  it("round-trips the ledger with renewal history", () => {
    const desks = {
      acme_ceo: {
        sessionId: "session-2026-09-01-09-00-00-a1b2c3d4",
        workspace: "/tmp/ws",
        openedAt: "2026-09-01T01:00:00.000Z",
        previous: ["session-2026-08-01-09-00-00-00000000"],
      },
    };
    expect(parseDesks(serializeDesks(desks))).toEqual({ ok: true, value: desks });
    expect(parseDesks("")).toEqual({ ok: true, value: {} });
  });
});

describe("calendar events", () => {
  it("accepts the schedule fields plus a title and rejects target fields", () => {
    const raw = serializeCalendarEvent({
      title: "Morning sweep",
      prompt: "Look at the board",
      enabled: true,
      startAt: "2026-09-01T09:00:00+08:00",
      period: "1d",
    });
    const parsed = parseCalendarEvent("sweep", raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.title).toBe("Morning sweep");
      expect(parsed.value.periodMs).toBe(86_400_000);
      expect(parsed.value.name).toBe("sweep");
    }
    const bad = parseCalendarEvent("sweep", `${raw}session_id = "session-x"\n`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("session_id");
  });
});

describe("tickets", () => {
  const doc: TicketDoc = {
    title: "Launch the site",
    status: "in_progress",
    initiator: "user:alice",
    owner: "agent:acme_dev",
    parent: "2026-09-01-marketplace",
    notify: ["agent:acme_ceo", "user:alice"],
    priority: "P1",
    due: "2026-09-15",
    blocked: "Domain not confirmed",
    blockedBy: "user:alice",
    sessions: ["session-2026-09-02-10-00-00-a1b2c3d4"],
    goal: "Ship the marketplace site.",
    acceptanceCriteria: "- Home page lists plugins\n- Search works",
    progress: [
      progressLine(
        "2026-09-02T10:12:00+08:00",
        "agent:acme_dev",
        "scaffolded the site",
        "session-2026-09-02-10-00-00-a1b2c3d4",
      ),
    ],
    result: "",
    extraHeaders: [],
    extraSections: [],
  };

  it("round-trips the header and the four sections", () => {
    const text = serializeTicket(doc);
    expect(text.startsWith("# Ticket: Launch the site\n\nStatus: in_progress\n")).toBe(true);
    expect(parseTicket(text)).toEqual({ ok: true, value: doc });
  });

  it("defaults Notify to the initiator and Priority to P2, keeps unknown headers and sections", () => {
    const text = [
      "# Ticket: Minimal",
      "",
      "Status: proposed",
      "Initiator: agent:acme_ceo",
      "Owner:",
      "X-Custom: kept",
      "",
      "## Goal",
      "Do the thing",
      "",
      "## Notes",
      "extra",
      "",
    ].join("\n");
    const parsed = parseTicket(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.notify).toEqual(["agent:acme_ceo"]);
    expect(parsed.value.priority).toBe("P2");
    expect(parsed.value.owner).toBeUndefined();
    expect(parsed.value.extraHeaders).toEqual([["X-Custom", "kept"]]);
    expect(parsed.value.extraSections).toEqual([{ heading: "Notes", body: "extra" }]);
    const again = parseTicket(serializeTicket(parsed.value));
    expect(again).toEqual(parsed);
  });

  it("rejects a bad status, principal or first line", () => {
    expect(parseTicket("# Ticket: x\n\nStatus: flying\nInitiator: user:a\n").ok).toBe(false);
    expect(parseTicket("# Ticket: x\n\nStatus: done\nInitiator: alice\n").ok).toBe(false);
    expect(parseTicket("Status: done\n").ok).toBe(false);
  });

  it("parses progress lines with and without a session reference", () => {
    expect(
      parseProgressLine("- 2026-09-02T10:12:00+08:00 agent:acme_dev did a thing session:session-x"),
    ).toEqual({
      time: "2026-09-02T10:12:00+08:00",
      by: "agent:acme_dev",
      text: "did a thing",
      sessionId: "session-x",
    });
    expect(parseProgressLine("- t user:alice created the ticket")).toEqual({
      time: "t",
      by: "user:alice",
      text: "created the ticket",
    });
    expect(parseProgressLine("nope")).toBeNull();
  });

  it("derives ids: month from the id, slug from the title, path from column", () => {
    expect(slugify("Launch the Site! v2")).toBe("launch-the-site-v2");
    expect(slugify("上线站点")).toBe("");
    expect(ticketMonth("2026-09-02-site")).toBe("2026-09");
    // Joined the way the store joins it, so the assertion holds on Windows too.
    expect(ticketPath("/org", "2026-09-02-site", "review")).toBe(
      path.join("/org", "tickets", "2026-09", "review", "2026-09-02-site.md"),
    );
  });
});

describe("channel files", () => {
  const site: ChannelConfig = {
    name: "Site launch",
    purpose: "Everything about shipping the marketplace site",
    createdBy: "user:alice",
    createdAt: "2026-09-03T01:00:00.000Z",
    archived: false,
    members: ["user:alice", "agent:acme_dev"],
  };

  it("round-trips a member channel and the all-hands channel", () => {
    const raw = serializeChannelConfig(site);
    expect(raw).toContain('members = [ "user:alice", "agent:acme_dev" ]');
    expect(parseChannelConfig("site", raw)).toEqual({ ok: true, value: site });

    const all: ChannelConfig = {
      name: "All hands",
      purpose: "",
      createdBy: "system",
      createdAt: "2026-09-03T01:00:00.000Z",
      archived: false,
      everyone: true,
    };
    const allRaw = serializeChannelConfig(all);
    expect(allRaw).toContain("everyone = true");
    expect(allRaw).not.toContain("members =");
    expect(parseChannelConfig(DEFAULT_CHANNEL_ID, allRaw)).toEqual({ ok: true, value: all });
  });

  it("tolerates a hand edit: a bare datetime, a missing purpose, archived", () => {
    const raw = [
      'name = "Marketing"',
      'created_by = "agent:acme_ceo"',
      "created_at = 2026-09-03T01:00:00Z",
      "archived = true",
      'members = ["agent:acme_marketing"]',
    ].join("\n");
    expect(parseChannelConfig("marketing", raw)).toEqual({
      ok: true,
      value: {
        name: "Marketing",
        purpose: "",
        createdBy: "agent:acme_ceo",
        createdAt: "2026-09-03T01:00:00.000Z",
        archived: true,
        members: ["agent:acme_marketing"],
      },
    });
  });

  it("rejects what the API would never write", () => {
    const errorOf = (channelId: string, lines: string[]): string => {
      const r = parseChannelConfig(channelId, lines.join("\n"));
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.error;
    };
    const base = [
      'name = "Site"',
      'created_by = "user:alice"',
      'created_at = "2026-09-03T01:00:00Z"',
    ];
    expect(errorOf("site", ['name = ""', ...base.slice(1), "members = []"])).toContain("name");
    expect(errorOf("site", [...base, "members = []", "created_by = 1"])).toContain("created_by");
    expect(
      errorOf("site", ['name = "Site"', 'created_by = "all"', base[2]!, "members = []"]),
    ).toContain("created_by");
    expect(
      errorOf("site", [
        'name = "Site"',
        'created_by = "user:alice"',
        'created_at = "soon"',
        "members = []",
      ]),
    ).toContain("created_at");
    // Membership: a bad principal, a duplicate, and no list at all.
    expect(errorOf("site", [...base, 'members = ["acme_dev"]'])).toContain("not a principal");
    expect(errorOf("site", [...base, 'members = ["agent:acme_dev", "agent:acme_dev"]'])).toContain(
      "duplicate member",
    );
    expect(errorOf("site", base)).toContain("members must be a list");
    // `everyone` belongs to the all-hands channel and to no other, and it keeps no list.
    expect(errorOf("site", [...base, "everyone = true"])).toContain("all-hands channel");
    expect(errorOf(DEFAULT_CHANNEL_ID, [...base, "members = []"])).toContain("everyone = true");
    expect(
      errorOf(DEFAULT_CHANNEL_ID, [...base, "everyone = true", 'members = ["user:alice"]']),
    ).toContain("keeps no members list");
  });

  it("names a channel's directory, config and day file", () => {
    expect(isChannelId("site")).toBe(true);
    expect(isChannelId(DEFAULT_CHANNEL_ID)).toBe(true);
    expect(isChannelId("Site")).toBe(false);
    expect(isChannelId("a")).toBe(false);
    expect(isChannelId("site-launch")).toBe(false);
    expect(channelConfigPath("/org", "site")).toBe(
      path.join("/org", "channels", "site", "channel.toml"),
    );
    expect(channelDayPath("/org", DEFAULT_CHANNEL_ID, "2026-09-03")).toBe(
      path.join("/org", "channels", "default_channel", "2026-09-03.jsonl"),
    );
  });
});

describe("channel message lines", () => {
  it("round-trips a message with refs and rejects malformed lines", () => {
    const msg = {
      id: "msg-2026-09-01-09-05-12-a1b2c3d4",
      time: "2026-09-01T01:05:12.000Z",
      sender: "agent:acme_hr",
      hop: 1,
      text: "@acme_ceo hired acme_dev",
      mentions: ["agent:acme_ceo"],
      refs: { ticket: "2026-09-01-site", replyTo: "msg-2026-09-01-09-00-00-00000000" },
    };
    const line = serializeChannelMessageLine(msg);
    expect(line).toContain('"reply_to"');
    expect(parseChannelMessageLine(line)).toEqual({ ok: true, value: msg });
    expect(parseChannelMessageLine("{").ok).toBe(false);
    expect(parseChannelMessageLine(JSON.stringify({ ...msg, hop: -1 })).ok).toBe(false);
    expect(parseChannelMessageLine(JSON.stringify({ ...msg, sender: "nobody" })).ok).toBe(false);
  });

  it("extracts mention tokens in short and prefixed forms", () => {
    expect(
      extractMentionTokens("@acme_ceo please review @user:alice and @all, not me@example.com"),
    ).toEqual([{ id: "acme_ceo" }, { prefix: "user", id: "alice" }, { id: "all" }]);
  });
});

describe("principals", () => {
  it("parses and formats the four forms", () => {
    expect(parsePrincipal("agent:acme_ceo")).toEqual({ kind: "agent", id: "acme_ceo" });
    expect(parsePrincipal("user:alice")).toEqual({ kind: "user", id: "alice" });
    expect(parsePrincipal("all")).toEqual({ kind: "all" });
    expect(parsePrincipal("system")).toEqual({ kind: "system" });
    expect(parsePrincipal("acme_ceo")).toBeNull();
    expect(formatPrincipal({ kind: "user", id: "alice" })).toBe("user:alice");
    expect(splitPrincipalList(" agent:a, user:b ,agent:a,")).toEqual(["agent:a", "user:b"]);
  });
});

describe("zoned time", () => {
  it("names days and months in the organization's timezone", () => {
    const ms = Date.parse("2026-08-31T20:30:00Z");
    expect(zonedDate("Asia/Shanghai", ms)).toBe("2026-09-01");
    expect(zonedDate("UTC", ms)).toBe("2026-08-31");
    expect(zonedOffsetMinutes("Asia/Shanghai", ms)).toBe(480);
  });

  it("bounds the natural month by UTC instants", () => {
    const r = zonedMonthRange("Asia/Shanghai", Date.parse("2026-09-15T00:00:00Z"));
    expect(r.period).toBe("2026-09");
    expect(new Date(r.fromMs).toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(new Date(r.toMs).toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(zonedPeriodRange("UTC", "2026-12")?.toMs).toBe(Date.UTC(2027, 0, 1));
    expect(zonedPeriodRange("UTC", "2026-13")).toBeNull();
  });
});
