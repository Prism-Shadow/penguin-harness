/**
 * CappedTextBuffer unit tests: capacity drop keeps the tail, the omitted tally accumulates,
 * drain() prefixes the drop marker and clears the buffer, and isEmpty tracks both text and tally.
 */
import { describe, expect, it } from "vitest";
import { CappedTextBuffer } from "../src/environment/tools/background/index.js";

describe("CappedTextBuffer", () => {
  it("starts empty and drains to an empty string", () => {
    const buf = new CappedTextBuffer(10, "earlier output");
    expect(buf.isEmpty).toBe(true);
    expect(buf.drain()).toBe("");
  });

  it("keeps content under capacity verbatim", () => {
    const buf = new CappedTextBuffer(10, "earlier output");
    buf.append("hello");
    expect(buf.isEmpty).toBe(false);
    expect(buf.drain()).toBe("hello");
    expect(buf.isEmpty).toBe(true);
  });

  it("drops the oldest chars past capacity and keeps the tail", () => {
    const buf = new CappedTextBuffer(5, "earlier output");
    buf.append("abcdefg"); // 7 chars, cap 5 -> drop "ab", keep "cdefg"
    expect(buf.drain()).toBe("[... 2 chars of earlier output dropped ...]\ncdefg");
  });

  it("handles a single append larger than the cap", () => {
    const buf = new CappedTextBuffer(3, "earlier output");
    buf.append("0123456789"); // drop 7, keep "789"
    expect(buf.drain()).toBe("[... 7 chars of earlier output dropped ...]\n789");
  });

  it("accumulates the omitted tally across multiple over-cap appends", () => {
    const buf = new CappedTextBuffer(4, "earlier output");
    buf.append("aaaaaa"); // drop 2, keep "aaaa"
    buf.append("bb"); // now "aaaabb" -> drop 2 more, keep "aabb"
    expect(buf.drain()).toBe("[... 4 chars of earlier output dropped ...]\naabb");
  });

  it("clears text and tally after drain", () => {
    const buf = new CappedTextBuffer(2, "earlier output");
    buf.append("xyz"); // drop 1, keep "yz"
    buf.drain();
    expect(buf.isEmpty).toBe(true);
    expect(buf.drain()).toBe("");
  });

  it("uses the drop label in the marker", () => {
    const buf = new CappedTextBuffer(1, "earlier subagent output");
    buf.append("ab"); // drop 1
    expect(buf.drain()).toBe("[... 1 chars of earlier subagent output dropped ...]\nb");
  });

  it("stays non-empty when only dropped chars remain unread", () => {
    const buf = new CappedTextBuffer(0, "earlier output");
    buf.append("ab"); // cap 0 -> everything dropped, text empty but tally=2
    expect(buf.isEmpty).toBe(false);
    expect(buf.drain()).toBe("[... 2 chars of earlier output dropped ...]\n");
  });
});
