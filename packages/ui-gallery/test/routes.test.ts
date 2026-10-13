/**
 * The site's addresses: a path names a route, a surface page is `/s/<surface>`, a library page
 * is `/c/<topic>`, the fonts pages are `/fonts`, `/fonts/specimens` and `/fonts/licences`, and
 * every link built for another page carries the view state.
 *
 * - Given a static build, every page has a copy of the document, and the address a static host
 *   serves it at (with the trailing slash it redirects to) names that page.
 * - Given the gallery built into the public site at `<site>/gallery/`, the site navbar's links
 *   lead to `<site>/`; in dev or in a build of the gallery alone, with no site around it, they
 *   lead to the public site.
 */
import { describe, expect, it } from "vitest";
import { SURFACE_IDS } from "../src/app/surfaces";
import { TOPIC_IDS } from "../src/library/topics";
import { deepPagePaths } from "../src/lib/page-paths";
import {
  anchorOf,
  FONTS_PAGE_IDS,
  fontsHref,
  fontsPath,
  homeHref,
  parseRoute,
  surfaceHref,
  surfacePath,
  topicHref,
  topicPath,
} from "../src/lib/routes";
import type { Route } from "../src/lib/routes";
import { DEFAULT_STATE } from "../src/lib/url-state";
import { PUBLIC_SITE_URL, siteUrlOf } from "../src/site/links";

const PREFS = "theme=modern&mode=light&size=m&latin=theme&cjk=theme&lang=en&accent=neutral";

describe("parseRoute", () => {
  it("names the home route", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
    expect(parseRoute("")).toEqual({ kind: "home" });
  });

  it("gives every surface a page at /s/<id>, and names what /s/<other> misses", () => {
    for (const id of SURFACE_IDS) {
      expect(parseRoute(surfacePath(id))).toEqual({ kind: "surface", id });
    }
    expect(parseRoute("/s/nope")).toEqual({ kind: "missing", id: "nope" });
    expect(parseRoute("/s/chat/extra")).toEqual({ kind: "unknown", path: "/s/chat/extra" });
  });

  it("gives every library topic a page at /c/<id>, and names what /c/<other> misses", () => {
    for (const id of TOPIC_IDS) {
      expect(parseRoute(topicPath(id))).toEqual({ kind: "topic", id });
    }
    expect(parseRoute("/c/nope")).toEqual({ kind: "missing", id: "nope" });
    // The one-page Foundations module is gone: its old address names nothing.
    expect(parseRoute("/c/foundations")).toEqual({ kind: "missing", id: "foundations" });
    expect(parseRoute("/c/buttons/extra")).toEqual({ kind: "unknown", path: "/c/buttons/extra" });
  });

  it("gives the fonts section three pages, the defaults at /fonts itself", () => {
    expect(FONTS_PAGE_IDS).toEqual(["defaults", "specimens", "licences"]);
    expect(fontsPath("defaults")).toBe("/fonts");
    expect(fontsPath("specimens")).toBe("/fonts/specimens");
    for (const page of FONTS_PAGE_IDS) {
      expect(parseRoute(fontsPath(page))).toEqual({ kind: "fonts", page });
    }
    expect(parseRoute("/fonts/")).toEqual({ kind: "fonts", page: "defaults" });
    expect(parseRoute("/fonts/nope")).toEqual({ kind: "missing", id: "nope" });
    // The retired routes name nothing now.
    expect(parseRoute("/embed").kind).toBe("unknown");
    expect(parseRoute("/screens/chat").kind).toBe("unknown");
  });
});

describe("links between pages", () => {
  const state = { ...DEFAULT_STATE, theme: "modern" as const };

  it("build a surface page's address with the view state", () => {
    expect(surfaceHref("", state, "models")).toBe(`/s/models?${PREFS}`);
    expect(surfaceHref("/gallery", state, "chat-new")).toBe(`/gallery/s/chat-new?${PREFS}`);
  });

  it("build a library page's address, with a group in the hash", () => {
    expect(topicHref("", state, "buttons")).toBe(`/c/buttons?${PREFS}`);
    expect(topicHref("", state, "colour", "surfaces")).toBe(`/c/colour?${PREFS}#surfaces`);
  });

  it("build the home and the fonts pages the same way", () => {
    expect(homeHref("", state, "surfaces")).toBe(`/?${PREFS}#surfaces`);
    expect(fontsHref("/base", state, "defaults")).toBe(`/base/fonts?${PREFS}`);
    expect(fontsHref("/base", state, "licences")).toBe(`/base/fonts/licences?${PREFS}`);
  });

  it("read the anchor a hash names", () => {
    expect(anchorOf("#colour")).toBe("colour");
    expect(anchorOf("#%E5%AF%B9%E8%AF%9D")).toBe("对话");
    expect(anchorOf("#")).toBeNull();
    expect(anchorOf("")).toBeNull();
  });
});

describe("on a static host", () => {
  it("every page has a copy of the document, at an address that names it", () => {
    const everyPage: Route[] = [
      ...SURFACE_IDS.map((id): Route => ({ kind: "surface", id })),
      ...TOPIC_IDS.map((id): Route => ({ kind: "topic", id })),
      ...FONTS_PAGE_IDS.map((page): Route => ({ kind: "fonts", page })),
    ];
    // The host answers `/s/chat` with a redirect to `/s/chat/`, where the copy sits.
    const served = deepPagePaths().map((path) => parseRoute(`${path}/`));
    expect(new Set(served)).toEqual(new Set(everyPage));
    expect(served).toHaveLength(everyPage.length);
  });
});

describe("the site navbar's links", () => {
  it("lead to the site the gallery is built into at <site>/gallery/", () => {
    expect(siteUrlOf("/gallery/")).toBe("/");
    expect(siteUrlOf("/penguin-harness/gallery/")).toBe("/penguin-harness/");
  });

  it("lead to the public site in dev, or from a build of the gallery alone", () => {
    expect(siteUrlOf("/")).toBe(PUBLIC_SITE_URL);
    expect(siteUrlOf("/ui/")).toBe(PUBLIC_SITE_URL);
    expect(siteUrlOf("/my-gallery/")).toBe(PUBLIC_SITE_URL);
  });
});
