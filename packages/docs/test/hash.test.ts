/**
 * hashTargetId: the URL hash -> element id step behind the router's scroll-to-hash effect and
 * the page's TOC pin. A browser reports a CJK fragment percent-encoded in location.hash, so
 * the heading id only matches once the hash is decoded; a malformed escape must fall back
 * instead of throwing, which inside an effect blanked the whole page.
 */
import { describe, expect, it } from "vitest";
import { hashTargetId } from "../src/lib/hash";
import { slugifyHeading } from "../src/lib/toc";

/** The hash a browser reports after following a link to `#<fragment>` (WHATWG URL parsing). */
const locationHash = (fragment: string) =>
  new URL(`#${fragment}`, "https://example.test/docs/quickstart-cli").hash;

describe("hashTargetId", () => {
  it("decodes a percent-encoded Chinese hash", () => {
    expect(hashTargetId("#%E5%AE%89%E8%A3%85%E5%8F%82%E8%80%83")).toBe("安装参考");
  });

  it("passes a raw Chinese hash through unchanged", () => {
    expect(hashTargetId("#安装参考")).toBe("安装参考");
    expect(hashTargetId("#钩子包")).toBe("钩子包");
  });

  it("accepts a fragment without the leading #", () => {
    expect(hashTargetId("%E5%AE%89%E8%A3%85%E5%8F%82%E8%80%83")).toBe("安装参考");
    expect(hashTargetId("安装参考")).toBe("安装参考");
  });

  it("falls back to the raw fragment when an escape is malformed", () => {
    expect(hashTargetId("#100%")).toBe("100%");
    expect(hashTargetId("#%zz")).toBe("%zz");
    expect(hashTargetId("#安装%参考")).toBe("安装%参考");
    // A truncated UTF-8 sequence is malformed too.
    expect(hashTargetId("#%E5%AE")).toBe("%E5%AE");
  });

  it("returns an empty id for an empty hash", () => {
    expect(hashTargetId("")).toBe("");
    expect(hashTargetId("#")).toBe("");
  });

  it("leaves an ASCII hash unchanged", () => {
    expect(hashTargetId("#stop-hooks")).toBe("stop-hooks");
    expect(hashTargetId("#command-policy")).toBe("command-policy");
    expect(hashTargetId("vault")).toBe("vault");
  });

  it("maps the hash of a CJK heading's anchor back to the heading's slug id", () => {
    for (const heading of ["安装参考", "User Prompt Hook 钩子", "第一步：配置模型（可选）"]) {
      const id = slugifyHeading(heading);
      const hash = locationHash(id);
      expect(hash, `location.hash for ${heading}`).not.toBe(`#${id}`);
      expect(hashTargetId(hash), `id for ${heading}`).toBe(id);
    }
  });
});
