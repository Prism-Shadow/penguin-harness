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
  isActiveRoadmap,
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
  it("lists only roadmaps under discussion, not shelved, with a room", () => {
    expect(isActiveRoadmap(roadmap({ number: 1 }))).toBe(true);
    expect(isActiveRoadmap(roadmap({ number: 2, archived: true }))).toBe(false);
    expect(isActiveRoadmap(roadmap({ number: 3, status: "established", archived: true }))).toBe(
      false,
    );
    expect(isActiveRoadmap(roadmap({ number: 4, status: "awaiting_room", channelId: null }))).toBe(
      false,
    );
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

  it("shows five and keeps the rest behind the expand", () => {
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

  it("says itself in both languages", () => {
    for (const S of [zh, en]) {
      expect(S.company.roadmaps.listTitle).not.toBe("");
      expect(S.company.roadmaps.showMore(3)).toContain("3");
      expect(S.company.roadmaps.panelTitle(9)).toContain("9");
      for (const key of ["showFewer", "all", "open", "none", "loadFailed", "hidePanel"] as const)
        expect(S.company.roadmaps[key]).not.toBe("");
    }
  });
});
