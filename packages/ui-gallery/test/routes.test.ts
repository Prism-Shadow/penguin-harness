/**
 * The site's addresses: a path names a route, a module page is `/c/<module>` with a variant or a
 * section in the hash, and every link built for another page carries the view state but never
 * one page's picks.
 */
import { describe, expect, it } from "vitest";
import { MODULE_IDS } from "../../ui/src/module";
import {
  anchorOf,
  homeHref,
  moduleHref,
  modulePath,
  pageState,
  parseRoute,
  routeHref,
} from "../src/lib/routes";
import { DEFAULT_STATE } from "../src/lib/url-state";

describe("parseRoute", () => {
  it("names the home, embed, screen and fonts routes", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
    expect(parseRoute("")).toEqual({ kind: "home" });
    expect(parseRoute("/embed")).toEqual({ kind: "embed" });
    expect(parseRoute("/fonts")).toEqual({ kind: "fonts" });
    expect(parseRoute("/fonts/")).toEqual({ kind: "fonts" });
    expect(parseRoute("/screens/chat")).toEqual({ kind: "screen", name: "chat" });
    expect(parseRoute("/screens/%E5%AF%B9%E8%AF%9D")).toEqual({ kind: "screen", name: "对话" });
  });

  it("gives every module a page at /c/<id>, and names what /c/<other> misses", () => {
    for (const id of MODULE_IDS) {
      expect(parseRoute(modulePath(id))).toEqual({ kind: "module", id });
    }
    expect(parseRoute("/c/nope")).toEqual({ kind: "missing", id: "nope" });
    expect(parseRoute("/c/status/extra")).toEqual({ kind: "unknown", path: "/c/status/extra" });
    expect(parseRoute("/gallery")).toEqual({ kind: "unknown", path: "/gallery" });
  });
});

describe("links between pages", () => {
  const state = {
    ...DEFAULT_STATE,
    theme: "modern" as const,
    compare: { module: "status" as const, variant: "live" },
    variants: { "actions-button": "danger.sm" },
  };

  it("build a module page's address with the view state, and the variant in the hash", () => {
    expect(moduleHref("", state, "conversation", "approval")).toBe(
      "/c/conversation?theme=modern&mode=light&tier=md&lang=en&accent=neutral#approval",
    );
    expect(moduleHref("/gallery", state, "create-with-ai")).toBe(
      "/gallery/c/create-with-ai?theme=modern&mode=light&tier=md&lang=en&accent=neutral",
    );
  });

  it("build the home and the other routes the same way", () => {
    expect(homeHref("", state, "components")).toBe(
      "/?theme=modern&mode=light&tier=md&lang=en&accent=neutral#components",
    );
    expect(routeHref("", state, "/fonts")).toBe(
      "/fonts?theme=modern&mode=light&tier=md&lang=en&accent=neutral",
    );
    expect(routeHref("/base", state, "/screens/chat")).toBe(
      "/base/screens/chat?theme=modern&mode=light&tier=md&lang=en&accent=neutral",
    );
  });

  it("carry a site-wide compare but drop a pinned one and every pick", () => {
    expect(pageState(state)).toEqual({ ...state, compare: false, variants: {} });
    expect(pageState({ ...state, compare: true }).compare).toBe(true);
    expect(pageState({ ...state, compare: "status" }).compare).toBe(false);
  });

  it("read the anchor a hash names", () => {
    expect(anchorOf("#approval")).toBe("approval");
    expect(anchorOf("#actions-button")).toBe("actions-button");
    expect(anchorOf("#%E5%AF%B9%E8%AF%9D")).toBe("对话");
    expect(anchorOf("#")).toBeNull();
    expect(anchorOf("")).toBeNull();
  });
});
