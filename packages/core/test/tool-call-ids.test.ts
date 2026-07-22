/**
 * ToolCallIdAllocator / stripToolCallIdSuffix unit tests: unique ids pass through, collisions
 * get a `#n` suffix (n from 2, first free slot), markUsed seeds the taken set, and the suffix
 * strip is shape-based and idempotent.
 */
import { describe, expect, it } from "vitest";
import { ToolCallIdAllocator, stripToolCallIdSuffix } from "../src/llm/tool-call-ids.js";

describe("ToolCallIdAllocator", () => {
  it("passes a unique id through unchanged", () => {
    const a = new ToolCallIdAllocator();
    expect(a.allocate("call_abc")).toBe("call_abc");
  });

  it("disambiguates repeats with #n starting at 2", () => {
    const a = new ToolCallIdAllocator();
    expect(a.allocate("get_weather")).toBe("get_weather");
    expect(a.allocate("get_weather")).toBe("get_weather#2");
    expect(a.allocate("get_weather")).toBe("get_weather#3");
  });

  it("keeps distinct base ids independent", () => {
    const a = new ToolCallIdAllocator();
    expect(a.allocate("f")).toBe("f");
    expect(a.allocate("g")).toBe("g");
    expect(a.allocate("f")).toBe("f#2");
  });

  it("skips ids already reserved by markUsed", () => {
    const a = new ToolCallIdAllocator();
    a.markUsed("dupe");
    a.markUsed("dupe#2");
    expect(a.allocate("dupe")).toBe("dupe#3");
  });

  it("markUsed twice is harmless", () => {
    const a = new ToolCallIdAllocator();
    a.markUsed("x");
    a.markUsed("x");
    expect(a.allocate("x")).toBe("x#2");
  });
});

describe("stripToolCallIdSuffix", () => {
  it("strips a #n suffix", () => {
    expect(stripToolCallIdSuffix("get_weather#2")).toBe("get_weather");
  });

  it("returns an unsuffixed id as-is", () => {
    expect(stripToolCallIdSuffix("call_abc")).toBe("call_abc");
    expect(stripToolCallIdSuffix("toolu_123")).toBe("toolu_123");
  });

  it("is idempotent", () => {
    const once = stripToolCallIdSuffix("f#3");
    expect(stripToolCallIdSuffix(once)).toBe("f");
  });

  it("only strips a trailing #<digits>, not other hashes", () => {
    expect(stripToolCallIdSuffix("a#b")).toBe("a#b");
    expect(stripToolCallIdSuffix("a#2b")).toBe("a#2b");
  });

  it("round-trips an allocated collision id back to the provider id", () => {
    const a = new ToolCallIdAllocator();
    a.allocate("name");
    const dup = a.allocate("name");
    expect(dup).toBe("name#2");
    expect(stripToolCallIdSuffix(dup)).toBe("name");
  });
});
