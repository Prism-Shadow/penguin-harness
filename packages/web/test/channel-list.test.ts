/**
 * channel-list.ts unit tests: the all-hands channel's reserved id and its localized label,
 * the four runs of the sidebar's list and the order inside them, the id a new channel may
 * take, the two numbers the sidebar and rail badges sum, and who is left to invite.
 */
import { describe, expect, it } from "vitest";
import type { OrgChannelItem } from "@prismshadow/penguin-server/api";
import {
  CHANNEL_ID_PATTERN,
  DEFAULT_CHANNEL_ID,
  channelBadgeCounts,
  channelIdProblem,
  channelLabel,
  groupChannels,
  inviteCandidates,
  isAllHands,
} from "../src/features/company/channel-list";

const channel = (over: Partial<OrgChannelItem> & { channelId: string }): OrgChannelItem => ({
  name: over.channelId,
  purpose: "",
  everyone: false,
  archived: false,
  createdBy: "user:alice",
  createdAt: "2026-09-03T00:00:00Z",
  memberCount: 1,
  isMember: true,
  unread: 0,
  mentionsMe: 0,
  lastMessageAt: null,
  ...over,
});

describe("the all-hands channel", () => {
  it("is `default_channel`, and renders under its localized label rather than its stored name", () => {
    expect(DEFAULT_CHANNEL_ID).toBe("default_channel");
    expect(isAllHands(DEFAULT_CHANNEL_ID)).toBe(true);
    expect(isAllHands("site")).toBe(false);
    expect(channelLabel({ channelId: DEFAULT_CHANNEL_ID, name: "General" }, "全员频道")).toBe(
      "全员频道",
    );
    expect(channelLabel({ channelId: "site", name: "Site launch" }, "全员频道")).toBe(
      "Site launch",
    );
  });
});

describe("channelIdProblem", () => {
  it("accepts the semantic-id grammar the server enforces", () => {
    expect(CHANNEL_ID_PATTERN.test("site")).toBe(true);
    for (const id of ["site", "site_2", "a1", "marketing_q4"]) {
      expect(channelIdProblem(id)).toBeNull();
    }
  });

  it("names why an id is refused, before the request goes out", () => {
    expect(channelIdProblem("")).toBe("required");
    expect(channelIdProblem("   ")).toBe("required");
    // A single character, a leading digit, an uppercase letter, a hyphen, and 65 characters.
    expect(channelIdProblem("a")).toBe("invalid");
    expect(channelIdProblem("1site")).toBe("invalid");
    expect(channelIdProblem("Site")).toBe("invalid");
    expect(channelIdProblem("site-launch")).toBe("invalid");
    expect(channelIdProblem(`a${"b".repeat(64)}`)).toBe("invalid");
    // The all-hands channel owns its id.
    expect(channelIdProblem(DEFAULT_CHANNEL_ID)).toBe("reserved");
    expect(channelIdProblem("site", ["site", "marketing"])).toBe("taken");
    expect(channelIdProblem("  site  ", ["site"])).toBe("taken");
    expect(channelIdProblem("design", ["site"])).toBeNull();
  });
});

describe("groupChannels", () => {
  const channels = [
    channel({ channelId: "site", name: "Site launch" }),
    channel({ channelId: DEFAULT_CHANNEL_ID, name: "General", everyone: true, memberCount: 4 }),
    channel({ channelId: "old_launch", name: "Launch 2025", archived: true }),
    channel({ channelId: "marketing", name: "Marketing", isMember: false }),
    channel({ channelId: "design", name: "Design" }),
    channel({ channelId: "gone", name: "Gone", isMember: false, archived: true }),
  ];

  it("pins the all-hands channel, then splits by membership, with archived winning over both", () => {
    const groups = groupChannels(channels, "All hands");
    expect(groups.allHands?.channelId).toBe(DEFAULT_CHANNEL_ID);
    expect(groups.mine.map((c) => c.channelId)).toEqual(["design", "site"]);
    expect(groups.others.map((c) => c.channelId)).toEqual(["marketing"]);
    // Archived channels fold away whether or not the caller is a member of them.
    expect(groups.archived.map((c) => c.channelId)).toEqual(["gone", "old_launch"]);
  });

  it("orders each run by display name, then by id for two channels of one name", () => {
    const same = [
      channel({ channelId: "b_room", name: "Room" }),
      channel({ channelId: "a_room", name: "Room" }),
      channel({ channelId: "zebra", name: "Alpha" }),
    ];
    expect(groupChannels(same, "All hands").mine.map((c) => c.channelId)).toEqual([
      "zebra",
      "a_room",
      "b_room",
    ]);
  });

  it("survives an organization whose all-hands channel is missing", () => {
    const groups = groupChannels([channel({ channelId: "site" })], "All hands");
    expect(groups.allHands).toBeNull();
    expect(groups.mine).toHaveLength(1);
  });
});

describe("channelBadgeCounts", () => {
  it("sums the channels the caller belongs to and skips the rest", () => {
    expect(
      channelBadgeCounts([
        channel({ channelId: DEFAULT_CHANNEL_ID, unread: 3, mentionsMe: 1 }),
        channel({ channelId: "site", unread: 2, mentionsMe: 2 }),
        // Readable but not joined: it is waiting for nobody.
        channel({ channelId: "marketing", isMember: false, unread: 9, mentionsMe: 4 }),
        // Archived: folded away in the list, so it must not sit in the total either.
        channel({ channelId: "old_launch", archived: true, unread: 7, mentionsMe: 5 }),
      ]),
    ).toEqual({ unread: 5, mentions: 3 });
    expect(channelBadgeCounts([])).toEqual({ unread: 0, mentions: 0 });
  });
});

describe("inviteCandidates", () => {
  const employees = [
    { agentId: "ceo", name: "Alice CEO", title: "CEO" },
    { agentId: "dev", name: "Dev Lead", title: "  " },
  ];

  it("offers employees then Project members, minus who is already in the channel", () => {
    const list = inviteCandidates(
      employees,
      ["alice", "bob"],
      [
        { principal: "agent:ceo", name: "Alice CEO", kind: "agent" as const },
        { principal: "user:alice", name: "alice", kind: "user" as const },
      ],
    );
    expect(list.map((c) => c.principal)).toEqual(["agent:dev", "user:bob"]);
    // A blank title is not a detail line.
    expect("detail" in list[0]!).toBe(false);
  });

  it("carries an employee's title and ranks a prefix above a substring", () => {
    const list = inviteCandidates(employees, ["alice"], []);
    expect(list[0]?.detail).toBe("CEO");
    expect(inviteCandidates(employees, ["alice"], [], "de").map((c) => c.principal)).toEqual([
      "agent:dev",
    ]);
    // "lice" is inside both the employee's name and the member's id; the member's id starts
    // with neither, so list order breaks the tie between two equal scores.
    expect(inviteCandidates(employees, ["alice"], [], "lice").map((c) => c.principal)).toEqual([
      "agent:ceo",
      "user:alice",
    ]);
    expect(inviteCandidates(employees, ["alice"], [], "zzz")).toEqual([]);
  });
});
