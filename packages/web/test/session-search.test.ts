/**
 * The sidebar search box's pure logic (lib/session-search.ts): what the "show more" row asks
 * for next, how a second page folds into the list already on screen, and how a server excerpt
 * is cut into highlighted spans. No DOM here by design — this package's vitest runs in a node
 * environment, so what renders is verified by hand and what decides is verified here.
 */
import { describe, expect, it } from "vitest";
import type { SearchHit, SearchResult } from "@prismshadow/penguin-server/api";
import {
  SEARCH_PAGE_SIZE,
  appendSearchPage,
  canLoadMoreSearch,
  toolDetail,
  markedSegments,
  nextSearchOffset,
  searchAgentScope,
  searchExcerpt,
} from "../src/lib/session-search";

/** A result row, with only the fields the pure functions read. */
const result = (sessionId: string, hits: SearchHit[] = []): SearchResult =>
  ({
    sessionId,
    projectId: "p1",
    agentId: "a1",
    provider: "openai_go",
    modelId: "m1",
    workspace: "/root/penguin",
    createdAt: "2026-09-28T00:00:00.000Z",
    lastActiveAt: "2026-09-28T01:00:00.000Z",
    archived: false,
    hasTrace: true,
    matchedTitle: false,
    matchCount: hits.length,
    hits,
  }) satisfies SearchResult;

const hit = (snippet: string, marks: Array<[number, number]> = []): SearchHit => ({
  role: "user",
  at: "2026-09-28T01:00:00.000Z",
  fileIndex: 0,
  lineNo: 1,
  snippet,
  marks,
});

describe("appendSearchPage", () => {
  it("appends the next page in order", () => {
    const first = [result("a"), result("b")];
    expect(appendSearchPage(first, [result("c")]).map((r) => r.sessionId)).toEqual(["a", "b", "c"]);
  });

  it("keeps the first of a duplicated row — offset paging over a re-ranked window repeats one", () => {
    // The re-rank happened between the two requests: "b" moved back into the window the
    // first page already covered. Rendering it twice would show one chat as two rows.
    const first = [result("a"), result("b")];
    const merged = appendSearchPage(first, [result("b"), result("c")]);
    expect(merged.map((r) => r.sessionId)).toEqual(["a", "b", "c"]);
    expect(merged[1]).toBe(first[1]);
  });

  it("returns the same array when the page added nothing, so the caller can skip the render", () => {
    const first = [result("a")];
    expect(appendSearchPage(first, [])).toBe(first);
    expect(appendSearchPage(first, [result("a")])).toBe(first);
  });

  it("does not mutate the page it was given", () => {
    const first = [result("a")];
    const next = [result("b")];
    appendSearchPage(first, next);
    expect(first).toHaveLength(1);
    expect(next).toHaveLength(1);
  });
});

describe("paging", () => {
  it("advances the offset by the page size", () => {
    expect(nextSearchOffset(0)).toBe(SEARCH_PAGE_SIZE);
    expect(nextSearchOffset(SEARCH_PAGE_SIZE)).toBe(SEARCH_PAGE_SIZE * 2);
    expect(nextSearchOffset(0, 10)).toBe(10);
  });

  it("owes a show-more row only while the server counts more matches than are on screen", () => {
    expect(canLoadMoreSearch(30, 30)).toBe(false);
    expect(canLoadMoreSearch(30, 31)).toBe(true);
    // total is Project-wide, so it can only be behind a dedupe that dropped duplicates.
    expect(canLoadMoreSearch(0, 0)).toBe(false);
  });
});

describe("searchAgentScope", () => {
  it("narrows to the current Agent under Agent grouping, and to nothing else", () => {
    expect(searchAgentScope("agent", "a1")).toBe("a1");
    // No Agent resolved: sending an empty agentId would ask for one specific Agent's rows.
    expect(searchAgentScope("agent", null)).toBeUndefined();
    // Workspace groups and the time buckets span every Agent by construction.
    expect(searchAgentScope("workspace", "a1")).toBeUndefined();
    expect(searchAgentScope("time", "a1")).toBeUndefined();
  });
});

describe("searchExcerpt", () => {
  it("shows the matched messages, capped at three", () => {
    const hits = [hit("one"), hit("two"), hit("three"), hit("four")];
    expect(searchExcerpt(result("a", hits))).toHaveLength(3);
  });

  it("shows nothing for a title-only match, which has no message to quote", () => {
    const r = result("a", [hit("never returned")]);
    r.matchedTitle = true;
    expect(searchExcerpt(r)).toEqual([]);
  });
});

describe("markedSegments", () => {
  it("splits the excerpt around the match", () => {
    expect(markedSegments("搜软著的材料", [[1, 3]])).toEqual([
      { text: "搜", marked: false },
      { text: "软著", marked: true },
      { text: "的材料", marked: false },
    ]);
  });

  it("marks a range that runs to the end, and one that starts at the beginning", () => {
    expect(markedSegments("abcd", [[2, 99]])).toEqual([
      { text: "ab", marked: false },
      { text: "cd", marked: true },
    ]);
    expect(markedSegments("abcd", [[0, 1]])).toEqual([
      { text: "a", marked: true },
      { text: "bcd", marked: false },
    ]);
  });

  it("merges abutting and overlapping ranges into one mark", () => {
    // Two words matched back to back: one highlight, not two abutting ones.
    expect(
      markedSegments("搜索软著材料", [
        [0, 2],
        [2, 4],
      ]),
    ).toEqual([
      { text: "搜索软著", marked: true },
      { text: "材料", marked: false },
    ]);
    // The second range starts INSIDE the first: it extends the mark rather than restarting
    // inside it, which would have left the already-covered word unmarked.
    expect(
      markedSegments("hello world", [
        [0, 5],
        [3, 8],
      ]),
    ).toEqual([
      { text: "hello wo", marked: true },
      { text: "rld", marked: false },
    ]);
    // Fully covered by an earlier mark: nothing new to cut, and no duplicate segment.
    expect(
      markedSegments("hello world", [
        [0, 5],
        [1, 4],
      ]),
    ).toEqual([
      { text: "hello", marked: true },
      { text: " world", marked: false },
    ]);
  });

  it("drops ranges that cover nothing, and clamps a negative one", () => {
    expect(markedSegments("abcd", [[2, 2]])).toEqual([{ text: "abcd", marked: false }]);
    // An inverted range would slice backwards and duplicate the tail.
    expect(markedSegments("abcd", [[3, 1]])).toEqual([{ text: "abcd", marked: false }]);
    expect(markedSegments("abcd", [[-5, 1]])).toEqual([
      { text: "a", marked: true },
      { text: "bcd", marked: false },
    ]);
  });

  it("an excerpt with no marks is one plain run — the server sends hits with none", () => {
    expect(markedSegments("hello", [])).toEqual([{ text: "hello", marked: false }]);
    expect(markedSegments("", [[0, 1]])).toEqual([]);
  });

  it("cuts at the offsets the server sent: leading spaces kept, and a surrogate pair is two units", () => {
    // The ranges are UTF-16 offsets INTO the snippet as it arrived. Trimming the excerpt
    // before slicing would shift every later range by the trimmed amount, and counting code
    // points instead of units would land the mark inside the emoji.
    expect(markedSegments("  软著材料", [[2, 4]])).toEqual([
      { text: "  ", marked: false },
      { text: "软著", marked: true },
      { text: "材料", marked: false },
    ]);
    // "a" = 1 unit, "😀" = 2 (0xD83D 0xDE00), so "b" starts at 3.
    expect(markedSegments("a😀b", [[3, 4]])).toEqual([
      { text: "a😀", marked: false },
      { text: "b", marked: true },
    ]);
  });
});

describe("toolDetail", () => {
  it("drops the tool name the label already carries", () => {
    expect(toolDetail("read_file", "read_file /root/a/b.md")).toBe("/root/a/b.md");
    expect(toolDetail("exec_command", "exec_command git status")).toBe("git status");
  });

  it("leaves a label that does not start with the name alone", () => {
    expect(toolDetail("read_file", "read_file")).toBe("read_file");
    expect(toolDetail("read_file", "/root/a")).toBe("/root/a");
  });
});
