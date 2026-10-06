import { describe, expect, it } from "vitest";
import { findMatches, matchAll, matchSnippet, stepMatchIndex } from "../src/lib/find-text";
import type { FindQuery } from "../src/lib/find-text";

/** A case-insensitive query, the default the find bar opens with. */
const q = (text: string, caseSensitive = false): FindQuery => ({ text, caseSensitive });

describe("findMatches", () => {
  it("returns nothing for an empty query — an empty query is not a search", () => {
    expect(findMatches("anything at all", q(""))).toEqual([]);
  });

  it("finds every occurrence, with end exclusive", () => {
    expect(findMatches("one two one", q("one"))).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("ignores case by default and honours it when asked", () => {
    expect(findMatches("Penguin penguin", q("PENGUIN"))).toHaveLength(2);
    expect(findMatches("Penguin penguin", q("Penguin", true))).toEqual([{ start: 0, end: 7 }]);
    expect(findMatches("Penguin penguin", q("penguin", true))).toEqual([{ start: 8, end: 15 }]);
  });

  it("does not match overlapping occurrences", () => {
    // "aa" in "aaa" is one hit, not two: the scan resumes after the match, not after its first char.
    expect(findMatches("aaa", q("aa"))).toEqual([{ start: 0, end: 2 }]);
  });

  it("treats the query as literal text, not a pattern", () => {
    expect(findMatches("a.c abc", q("a.c"))).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches("$1.00 and $1.00", q("$1.00"))).toHaveLength(2);
  });

  it("matches across the whole string, including newlines", () => {
    expect(findMatches("first\nsecond", q("t\ns"))).toEqual([{ start: 4, end: 7 }]);
  });

  it("returns nothing when the query is longer than the haystack", () => {
    expect(findMatches("hi", q("hi there"))).toEqual([]);
  });
});

describe("matchAll", () => {
  it("finds matches whose casing survives a length-preserving fold", () => {
    expect(matchAll("Okay OKAY okay", q("okay"))).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });

  it("keeps every offset correct where folding changes the length", () => {
    // U+0130 (İ) lowercases to two code units, so the fast indexOf path would shift every
    // offset after it; the fallback has to land on the real position.
    const haystack = "İİİ needle";
    expect(matchAll(haystack, q("needle"))).toEqual([{ start: 4, end: 10 }]);
    expect(matchAll(haystack, q("needle"))[0]!.start).toBe(haystack.indexOf("needle"));
  });

  it("still finds a match that sits before the length-changing character", () => {
    const haystack = "needle İİİ";
    expect(matchAll(haystack, q("NEEDLE"))).toEqual([{ start: 0, end: 6 }]);
  });

  it("agrees with findMatches when the fold is offset-safe", () => {
    const haystack = "The quick brown fox jumps over the lazy dog";
    for (const query of [q("the"), q("o"), q("THE", false), q("The", true)]) {
      expect(matchAll(haystack, query)).toEqual(findMatches(haystack, query));
    }
  });
});

describe("stepMatchIndex", () => {
  it("has nothing to step through when there are no matches", () => {
    expect(stepMatchIndex(-1, 0, 1)).toBe(-1);
    expect(stepMatchIndex(0, 0, -1)).toBe(-1);
  });

  it("enters the list at the end the direction implies", () => {
    expect(stepMatchIndex(-1, 5, 1)).toBe(0);
    expect(stepMatchIndex(-1, 5, -1)).toBe(4);
  });

  it("wraps at both ends", () => {
    expect(stepMatchIndex(4, 5, 1)).toBe(0);
    expect(stepMatchIndex(0, 5, -1)).toBe(4);
  });

  it("steps by more than one", () => {
    expect(stepMatchIndex(0, 5, 3)).toBe(3);
    expect(stepMatchIndex(1, 5, 3)).toBe(4);
    expect(stepMatchIndex(2, 5, 3)).toBe(0);
  });
});

describe("matchSnippet", () => {
  it("keeps the whole line when it fits inside the radius", () => {
    expect(matchSnippet("hello world", { start: 6, end: 11 }, 40)).toEqual({
      before: "hello ",
      hit: "world",
      after: "",
    });
  });

  it("marks a cut with an ellipsis and keeps the match's own casing", () => {
    const text = "0123456789 PENGUIN 0123456789";
    const snippet = matchSnippet(text, { start: 11, end: 18 }, 3);
    expect(snippet.hit).toBe("PENGUIN");
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
  });

  it("drops a partial word left by the cut rather than showing half of it", () => {
    const text = "abcdefghij needle xyz";
    const snippet = matchSnippet(text, { start: 11, end: 17 }, 6);
    expect(snippet.before).toBe("…");
    expect(snippet.hit).toBe("needle");
  });

  it("keeps a whole word that survives the cut", () => {
    const text = "alpha beta gamma delta";
    const snippet = matchSnippet(text, { start: 11, end: 16 }, 6);
    expect(snippet.before).toBe("…beta ");
    expect(snippet.hit).toBe("gamma");
  });

  it("keeps the cut in text with no spaces to cut at (CJK)", () => {
    const text = "一二三四五六七八九十目标文字";
    const snippet = matchSnippet(text, { start: 10, end: 14 }, 3);
    expect(snippet.before).toBe("…八九十");
    expect(snippet.hit).toBe("目标文字");
  });

  it("flattens newlines: a result row is one line", () => {
    const text = "line one\nstill one needle\nline three";
    const snippet = matchSnippet(text, { start: 19, end: 25 }, 8);
    expect(snippet.before).not.toContain("\n");
    expect(snippet.after).not.toContain("\n");
    expect(snippet.hit).toBe("needle");
  });

  it("never leaks a character of the match into the context", () => {
    const text = "aaaaaaaa needle bbbbbbbb";
    const snippet = matchSnippet(text, { start: 9, end: 15 }, 100);
    expect(snippet.before + snippet.hit + snippet.after).toBe(text);
  });
});
