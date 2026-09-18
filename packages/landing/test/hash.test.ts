/**
 * hashTargetId: the URL hash -> element id step behind the router's scroll-to-hash effect.
 * A browser reports a CJK fragment percent-encoded in location.hash, so the heading id only
 * matches once the hash is decoded; a malformed escape must fall back instead of throwing.
 */
import { describe, expect, it } from "vitest";
import { hashTargetId } from "../src/lib/hash";
import { slugifyHeading } from "../src/lib/toc";

/** The hash a browser reports after following a link to `#<fragment>` (WHATWG URL parsing). */
const locationHash = (fragment: string) =>
  new URL(`#${fragment}`, "https://example.test/blog/post").hash;

describe("hashTargetId", () => {
  it("decodes a percent-encoded Chinese hash", () => {
    expect(hashTargetId("#%E5%8D%87%E7%BA%A7%E9%A1%BB%E7%9F%A5")).toBe("升级须知");
  });

  it("passes a raw Chinese hash through unchanged", () => {
    expect(hashTargetId("#升级须知")).toBe("升级须知");
    expect(hashTargetId("#为什么是-penguinharness")).toBe("为什么是-penguinharness");
  });

  it("accepts a fragment without the leading #", () => {
    expect(hashTargetId("%E5%8D%87%E7%BA%A7%E9%A1%BB%E7%9F%A5")).toBe("升级须知");
    expect(hashTargetId("升级须知")).toBe("升级须知");
  });

  it("falls back to the raw fragment when an escape is malformed", () => {
    expect(hashTargetId("#100%")).toBe("100%");
    expect(hashTargetId("#%zz")).toBe("%zz");
    expect(hashTargetId("#升级%须知")).toBe("升级%须知");
    // A truncated UTF-8 sequence is malformed too.
    expect(hashTargetId("#%E5%8D")).toBe("%E5%8D");
  });

  it("returns an empty id for an empty hash", () => {
    expect(hashTargetId("")).toBe("");
    expect(hashTargetId("#")).toBe("");
  });

  it("leaves an ASCII hash unchanged", () => {
    expect(hashTargetId("#quickstart")).toBe("quickstart");
    expect(hashTargetId("#self-improvement")).toBe("self-improvement");
    expect(hashTargetId("upgrading")).toBe("upgrading");
  });

  it("maps the hash of a CJK heading's anchor back to the heading's slug id", () => {
    for (const heading of [
      "升级须知",
      "为什么是 PenguinHarness",
      "第一步：安装（Linux）",
      "0.2.4 的变化",
    ]) {
      const id = slugifyHeading(heading);
      const hash = locationHash(id);
      expect(hash, `location.hash for ${heading}`).not.toBe(`#${id}`);
      expect(hashTargetId(hash), `id for ${heading}`).toBe(id);
    }
  });
});
