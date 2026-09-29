/**
 * Roadmaps in the company layout (features/company/roadmaps.ts): the sidebar's ROADMAPS section
 * shows the five most recently active roadmaps under discussion and keeps the rest behind its
 * expand; a roadmap's room shows the plugin's page in its detail view; both exist only while the
 * roadmaps page is contributed.
 */
import { describe, expect, it } from "vitest";
import type { OrgRoadmapItem } from "../src/api/endpoints";
import {
  ROADMAPS_SHOWN,
  isListedRoadmap,
  roomAfterMessage,
  roomCounts,
  roomFromRead,
  lastActivity,
  roadmapDetailSrc,
  roadmapsPageSrc,
  sidebarRoadmaps,
} from "../src/features/company/roadmaps";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const roadmap = (over: Partial<OrgRoadmapItem> & { number: number }): OrgRoadmapItem => ({
  name: `Roadmap ${over.number}`,
  status: "discussing",
  archived: false,
  channelId: `roadmap_${over.number}`,
  createdAt: `2026-09-28T10:0${over.number % 10}:00.000Z`,
  ...over,
});

describe("the roadmaps page, as the app finds it", () => {
  const page = {
    key: "roadmaps",
    nav: "org",
    renderer: { iframe: { src: "/api/company-roadmaps/page", namespace: "company-roadmaps" } },
  };

  it("is the contributed iframe page keyed roadmaps; nothing else stands for it", () => {
    expect(roadmapsPageSrc([page])).toBe("/api/company-roadmaps/page");
    expect(roadmapsPageSrc([])).toBeNull();
    expect(roadmapsPageSrc([{ ...page, renderer: { builtin: "roadmaps" } }])).toBeNull();
    expect(roadmapsPageSrc([{ ...page, nav: "main" }])).toBeNull();
    expect(roadmapsPageSrc([{ ...page, key: "other" }])).toBeNull();
  });

  it("shows one roadmap in its detail view", () => {
    expect(roadmapDetailSrc("/api/company-roadmaps/page", 7)).toBe(
      "/api/company-roadmaps/page?view=detail&n=7",
    );
    expect(roadmapDetailSrc("/p?x=1", 2)).toBe("/p?x=1&view=detail&n=2");
  });
});

describe("the sidebar's ROADMAPS section", () => {
  it("lists every roadmap with a room that is not shelved — established ones too", () => {
    expect(isListedRoadmap(roadmap({ number: 1 }))).toBe(true);
    expect(isListedRoadmap(roadmap({ number: 2, status: "established" }))).toBe(true);
    expect(isListedRoadmap(roadmap({ number: 3, archived: true }))).toBe(false);
    expect(isListedRoadmap(roadmap({ number: 4, status: "established", archived: true }))).toBe(
      false,
    );
    expect(isListedRoadmap(roadmap({ number: 5, status: "awaiting_room", channelId: null }))).toBe(
      false,
    );
  });

  it("counts a reply in the room as activity: an established roadmap spoken in moves first", () => {
    // Roadmap 3 was established at 04:17 and roadmap 4 opened at 06:40; then someone replied in
    // roadmap 3's room at 06:50. Without the room, 4 stays on top; with it, 3 does.
    const established = roadmap({
      number: 3,
      status: "established",
      createdAt: "2026-09-29T02:59:00.000Z",
      events: [{ at: "2026-09-29T04:17:52.000Z" }],
    });
    const fresh = roadmap({ number: 4, createdAt: "2026-09-29T06:40:00.000Z" });
    expect(sidebarRoadmaps([established, fresh]).shown.map((r) => r.number)).toEqual([4, 3]);
    const rooms = { roadmap_3: "2026-09-29T06:50:00.000Z" };
    expect(sidebarRoadmaps([established, fresh], rooms).shown.map((r) => r.number)).toEqual([3, 4]);
    expect(lastActivity(established, rooms.roadmap_3)).toBe("2026-09-29T06:50:00.000Z");
    // An older room message changes nothing, and neither does an unknown one.
    expect(lastActivity(established, "2026-09-29T03:00:00.000Z")).toBe("2026-09-29T04:17:52.000Z");
    expect(lastActivity(established, null)).toBe("2026-09-29T04:17:52.000Z");
  });

  it("puts the most recently active first — its latest event, else when it opened", () => {
    const quiet = roadmap({ number: 1, createdAt: "2026-09-28T09:00:00.000Z" });
    const busy = roadmap({
      number: 2,
      createdAt: "2026-09-28T08:00:00.000Z",
      events: [{ at: "2026-09-28T08:00:00.000Z" }, { at: "2026-09-28T11:00:00.000Z" }],
    });
    expect(lastActivity(busy)).toBe("2026-09-28T11:00:00.000Z");
    expect(lastActivity(quiet)).toBe("2026-09-28T09:00:00.000Z");
    expect(sidebarRoadmaps([quiet, busy]).shown.map((r) => r.number)).toEqual([2, 1]);
    // Same moment: the later roadmap first.
    const a = roadmap({ number: 3, createdAt: "2026-09-28T12:00:00.000Z" });
    const b = roadmap({ number: 4, createdAt: "2026-09-28T12:00:00.000Z" });
    expect(sidebarRoadmaps([a, b]).shown.map((r) => r.number)).toEqual([4, 3]);
  });

  it("shows five and folds the rest under More", () => {
    expect(ROADMAPS_SHOWN).toBe(5);
    const all = Array.from({ length: 8 }, (_, i) =>
      roadmap({ number: i + 1, createdAt: `2026-09-28T10:0${i}:00.000Z` }),
    );
    const { shown, more } = sidebarRoadmaps([
      ...all,
      roadmap({ number: 20, archived: true, createdAt: "2026-09-28T23:00:00.000Z" }),
    ]);
    expect(shown.map((r) => r.number)).toEqual([8, 7, 6, 5, 4]);
    expect(more.map((r) => r.number)).toEqual([3, 2, 1]);
    expect(sidebarRoadmaps(all.slice(0, 3)).more).toEqual([]);
  });

  it("gives a room the unread and @me counts a channel row has, cleared by reading it", () => {
    const me = "user:u1";
    // The room's read at t=100 finds 2 unread, 1 naming the reader.
    const read = roomFromRead(
      undefined,
      { lastMessageAt: "2026-09-29T09:40:00.000Z", unread: 2, mentionsMe: 1, isMember: true },
      100,
    );
    expect(roomCounts(read, undefined)).toEqual({ unread: 2, mentionsMe: 1 });
    // Marked read at or after the read went out: no badge, even before the server's cursor moves.
    expect(roomCounts(read, 100)).toEqual({ unread: 0, mentionsMe: 0 });
    expect(roomCounts(read, 99)).toEqual({ unread: 2, mentionsMe: 1 });

    // Someone else posts: one more unread; naming the reader adds an @me.
    const msg = (sender: string, mentions: string[] = []) => ({
      time: "2026-09-29T09:41:38.000Z",
      sender,
      mentions,
    });
    const one = roomAfterMessage(read, msg("agent:penguin_ceo"), me, undefined, 200);
    expect(roomCounts(one, undefined)).toEqual({ unread: 3, mentionsMe: 1 });
    expect(one.lastMessageAt).toBe("2026-09-29T09:41:38.000Z");
    const two = roomAfterMessage(one, msg("agent:penguin_ceo", [me]), me, undefined, 300);
    expect(roomCounts(two, undefined)).toEqual({ unread: 4, mentionsMe: 2 });

    // Read at 250, then a message at 300: the badge counts from zero again, not from 3.
    const afterRead = roomAfterMessage(one, msg("agent:penguin_ceo"), me, 250, 300);
    expect(roomCounts(afterRead, 250)).toEqual({ unread: 1, mentionsMe: 0 });

    // The reader's own message, and a room the reader is not in, count nothing — but still move it.
    const own = roomAfterMessage(read, msg(me), me, undefined, 400);
    expect(roomCounts(own, undefined)).toEqual({ unread: 2, mentionsMe: 1 });
    const outside = roomFromRead(
      undefined,
      { lastMessageAt: null, unread: 0, mentionsMe: 0, isMember: false },
      100,
    );
    const heard = roomAfterMessage(outside, msg("agent:penguin_ceo", [me]), me, undefined, 500);
    expect(roomCounts(heard, undefined)).toEqual({ unread: 0, mentionsMe: 0 });
    expect(heard.lastMessageAt).toBe("2026-09-29T09:41:38.000Z");

    // A room not read yet rises on a message but is not guessed at.
    const unknown = roomAfterMessage(undefined, msg("agent:penguin_ceo"), me, undefined, 600);
    expect(unknown.lastMessageAt).toBe("2026-09-29T09:41:38.000Z");
    expect(roomCounts(unknown, undefined)).toEqual({ unread: 0, mentionsMe: 0 });
  });

  it("keeps an event's newer counts over a read that went out before it", () => {
    const me = "user:u1";
    const read = roomFromRead(
      undefined,
      { lastMessageAt: null, unread: 0, mentionsMe: 0, isMember: true },
      100,
    );
    const bumped = roomAfterMessage(
      read,
      { time: "2026-09-29T10:00:00.000Z", sender: "agent:a", mentions: [] },
      me,
      undefined,
      300,
    );
    // A second read started at 200 answers after the event: its counts are older, the event's stay.
    const again = roomFromRead(
      bumped,
      { lastMessageAt: "2026-09-29T09:00:00.000Z", unread: 0, mentionsMe: 0, isMember: true },
      200,
    );
    expect(roomCounts(again, undefined)).toEqual({ unread: 1, mentionsMe: 0 });
    expect(again.lastMessageAt).toBe("2026-09-29T10:00:00.000Z");
    // A read started after the event is the newer one and wins.
    const later = roomFromRead(
      bumped,
      { lastMessageAt: "2026-09-29T10:00:00.000Z", unread: 5, mentionsMe: 0, isMember: true },
      400,
    );
    expect(roomCounts(later, undefined)).toEqual({ unread: 5, mentionsMe: 0 });
  });

  it("says itself in both languages", () => {
    for (const S of [zh, en]) {
      expect(S.company.roadmaps.listTitle).not.toBe("");
      expect(S.company.roadmaps.panelTitle(9)).toContain("9");
      for (const key of ["moreGroup", "all", "open", "none", "loadFailed", "hidePanel"] as const)
        expect(S.company.roadmaps[key]).not.toBe("");
    }
  });
});
