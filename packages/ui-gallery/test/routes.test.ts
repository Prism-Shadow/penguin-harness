/**
 * The site's addresses: a path names a route, a surface page is `/s/<surface>`, a module page is
 * `/c/<module>` with a board or a section in the hash, and every link built for another page
 * carries the view state but never one page's pinned compare.
 */
import { describe, expect, it } from "vitest";
import { MODULE_IDS } from "../../ui/src/module";
import { SURFACE_IDS } from "../src/app/surfaces";
import {
  anchorOf,
  homeHref,
  moduleHref,
  modulePath,
  pageState,
  parseRoute,
  routeHref,
  surfaceHref,
  surfacePath,
} from "../src/lib/routes";
import { DEFAULT_STATE } from "../src/lib/url-state";

const PREFS = "theme=modern&mode=light&size=m&latin=theme&cjk=theme&lang=en&accent=neutral";

describe("parseRoute", () => {
  it("names the home and fonts routes", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
    expect(parseRoute("")).toEqual({ kind: "home" });
    expect(parseRoute("/fonts")).toEqual({ kind: "fonts" });
    expect(parseRoute("/fonts/")).toEqual({ kind: "fonts" });
  });

  it("gives every surface a page at /s/<id>, and names what /s/<other> misses", () => {
    for (const id of SURFACE_IDS) {
      expect(parseRoute(surfacePath(id))).toEqual({ kind: "surface", id });
    }
    expect(parseRoute("/s/nope")).toEqual({ kind: "missing", id: "nope" });
    expect(parseRoute("/s/chat/extra")).toEqual({ kind: "unknown", path: "/s/chat/extra" });
  });

  it("gives every module a page at /c/<id>, and names what /c/<other> misses", () => {
    for (const id of MODULE_IDS) {
      expect(parseRoute(modulePath(id))).toEqual({ kind: "module", id });
    }
    expect(parseRoute("/c/nope")).toEqual({ kind: "missing", id: "nope" });
    expect(parseRoute("/c/foundations/extra")).toEqual({
      kind: "unknown",
      path: "/c/foundations/extra",
    });
    // The retired routes name nothing now.
    expect(parseRoute("/embed").kind).toBe("unknown");
    expect(parseRoute("/screens/chat").kind).toBe("unknown");
  });
});

describe("links between pages", () => {
  const state = { ...DEFAULT_STATE, theme: "modern" as const, compare: "chat" as const };

  it("build a surface page's address with the view state, dropping the pinned compare", () => {
    expect(surfaceHref("", state, "models")).toBe(`/s/models?${PREFS}`);
    expect(surfaceHref("/gallery", state, "chat-new")).toBe(`/gallery/s/chat-new?${PREFS}`);
  });

  it("build a module page's address with the board in the hash", () => {
    expect(moduleHref("", state, "foundations", "colour")).toBe(`/c/foundations?${PREFS}#colour`);
  });

  it("build the home and the other routes the same way", () => {
    expect(homeHref("", state, "surfaces")).toBe(`/?${PREFS}#surfaces`);
    expect(routeHref("/base", state, "/fonts")).toBe(`/base/fonts?${PREFS}`);
  });

  it("carry a site-wide compare but drop a pinned one", () => {
    expect(pageState(state)).toEqual({ ...state, compare: false });
    expect(pageState({ ...state, compare: true }).compare).toBe(true);
  });

  it("read the anchor a hash names", () => {
    expect(anchorOf("#colour")).toBe("colour");
    expect(anchorOf("#%E5%AF%B9%E8%AF%9D")).toBe("对话");
    expect(anchorOf("#")).toBeNull();
    expect(anchorOf("")).toBeNull();
  });
});
