/**
 * The full search page's filter logic (lib/session-search.ts): which request a set of filters
 * asks the server for, what makes two filter sets "the same search", and the route the
 * sidebar's quick box uses to hand its query over.
 *
 * Kept separate from test/session-search.test.ts (which covers the sidebar panel's paging and
 * excerpt cutting) because these are the page's own decisions: what to send, when to re-send,
 * and where the quick box goes.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DEFAULT_SEARCH_FILTERS,
  searchFilterKey,
  searchPagePath,
  searchRangeBounds,
  searchRequest,
} from "../src/lib/session-search";
import type { SearchFilters } from "../src/lib/session-search";

const filters = (over: Partial<SearchFilters> = {}): SearchFilters => ({
  ...DEFAULT_SEARCH_FILTERS,
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("searchRangeBounds", () => {
  it("any time asks for no bound at all, not for some very old date", () => {
    expect(searchRangeBounds("all", new Date(2026, 8, 28))).toEqual({});
  });

  it("today is one day, 7d is a trailing week, 30d a trailing month — both inclusive", () => {
    const today = new Date(2026, 8, 28, 15, 30);
    expect(searchRangeBounds("today", today)).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(searchRangeBounds("7d", today)).toEqual({ from: "2026-09-22", to: "2026-09-28" });
    expect(searchRangeBounds("30d", today)).toEqual({ from: "2026-08-30", to: "2026-09-28" });
  });

  it("a window reaching back across a month boundary counts calendar days", () => {
    expect(searchRangeBounds("7d", new Date(2026, 2, 1))).toEqual({
      from: "2026-02-23",
      to: "2026-03-01",
    });
  });
});

describe("searchRequest", () => {
  it("the defaults ask for relevance over the whole Project, one page", () => {
    expect(searchRequest("  部署  ", DEFAULT_SEARCH_FILTERS, 0)).toEqual({
      q: "部署",
      limit: 30,
      offset: 0,
      sort: "relevance",
    });
  });

  it("only the filters that are set are sent — an empty one is absent, not empty", () => {
    const req = searchRequest(
      "x",
      filters({ workspace: "   ", agentId: undefined, includeArchived: false }),
      0,
    );
    expect(req).not.toHaveProperty("workspace");
    expect(req).not.toHaveProperty("agentId");
    expect(req).not.toHaveProperty("includeArchived");
    expect(req).not.toHaveProperty("from");
  });

  it("a set filter rides: agent, trimmed workspace, the window, archived, the sort", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 15, 30));
    const req = searchRequest(
      "x",
      filters({
        agentId: "a-1",
        workspace: "  /root/penguin  ",
        range: "7d",
        includeArchived: true,
        sort: "recent",
      }),
      30,
    );
    expect(req).toEqual({
      q: "x",
      agentId: "a-1",
      workspace: "/root/penguin",
      from: "2026-09-22",
      to: "2026-09-28",
      includeArchived: true,
      limit: 30,
      offset: 30,
      sort: "recent",
    });
  });

  it("the page asked for rides the offset, and a custom limit overrides the default", () => {
    expect(searchRequest("x", DEFAULT_SEARCH_FILTERS, 60).offset).toBe(60);
    expect(searchRequest("x", DEFAULT_SEARCH_FILTERS, 0, 10).limit).toBe(10);
  });
});

describe("searchFilterKey", () => {
  it("two sets that mean the same search share a key (a re-created object must not re-search)", () => {
    const a = filters({ agentId: "a-1", workspace: "  /root  " });
    const b = filters({ agentId: "a-1", workspace: "/root" });
    expect(searchFilterKey(a)).toBe(searchFilterKey(b));
  });

  it("each field is part of the identity", () => {
    const base = searchFilterKey(DEFAULT_SEARCH_FILTERS);
    expect(searchFilterKey(filters({ agentId: "a-1" }))).not.toBe(base);
    expect(searchFilterKey(filters({ workspace: "/root" }))).not.toBe(base);
    expect(searchFilterKey(filters({ range: "7d" }))).not.toBe(base);
    expect(searchFilterKey(filters({ includeArchived: true }))).not.toBe(base);
    expect(searchFilterKey(filters({ sort: "recent" }))).not.toBe(base);
  });
});

describe("searchPagePath", () => {
  it("carries the query the sidebar is holding, escaped", () => {
    expect(searchPagePath("  胸痛中心 ")).toBe("/search?q=%E8%83%B8%E7%97%9B%E4%B8%AD%E5%BF%83");
  });

  it("a blank query asks for the page's own empty state, not a request it would refuse", () => {
    expect(searchPagePath("   ")).toBe("/search");
    expect(searchPagePath("")).toBe("/search");
  });
});
