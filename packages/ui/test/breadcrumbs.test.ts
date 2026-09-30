/**
 * The breadcrumbs (src/components/navigation/breadcrumbs): which trailing items fit a one-row
 * strip and the width an item is priced at, how a file name splits so its stem gives way first,
 * and the strip itself — the whole path before it has measured anything, the last item split,
 * and a button only for an item that goes somewhere.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "../src/components/navigation/breadcrumbs/breadcrumbs";
import {
  crumbItemWidth,
  splitFileName,
  visibleCrumbSegments,
} from "../src/components/navigation/breadcrumbs/crumb-fit";
import { renderStatic } from "../src/testing";

describe("visibleCrumbSegments", () => {
  /** A fixed advance per character, so the fit is arithmetic rather than a font. */
  const measure = (text: string): number => text.length * 10;

  it("shows the whole path when it fits", () => {
    expect(visibleCrumbSegments(["root", "aa", "bb"], 1000, measure)).toEqual({
      visible: ["root", "aa", "bb"],
      collapsed: false,
    });
    expect(visibleCrumbSegments([], 1000, measure)).toEqual({ visible: [], collapsed: false });
  });

  it("drops leading segments until the rest fit, pricing in the ellipsis they become", () => {
    // "cc" 20 + "bb" 20 + the ellipsis still ahead of them 10 = 50, within 60; "aa" would
    // make it 70.
    expect(visibleCrumbSegments(["root", "aa", "bb", "cc"], 60, measure)).toEqual({
      visible: ["bb", "cc"],
      collapsed: true,
    });
    // At 100 the first segment fits too, and with nothing left ahead of it there is no
    // ellipsis to pay for.
    expect(visibleCrumbSegments(["root", "aa", "bb", "cc"], 100, measure)).toEqual({
      visible: ["root", "aa", "bb", "cc"],
      collapsed: false,
    });
  });

  it("always keeps the last item, however little room there is", () => {
    expect(visibleCrumbSegments(["root", "aa", "bb"], 0, measure)).toEqual({
      visible: ["bb"],
      collapsed: true,
    });
  });

  it("prices a wide character at two narrow ones", () => {
    expect(crumbItemWidth("文档") - crumbItemWidth("")).toBe(
      crumbItemWidth("docs") - crumbItemWidth(""),
    );
  });
});

describe("splitFileName", () => {
  it("keeps the extension whole so it can outlive a truncated stem", () => {
    expect(splitFileName("workspace-browser.tsx")).toEqual({
      stem: "workspace-browser",
      ext: ".tsx",
    });
    expect(splitFileName("archive.tar.gz")).toEqual({ stem: "archive.tar", ext: ".gz" });
  });

  it("treats a leading dot as part of the name, and a name with no dot as all stem", () => {
    // `.gitignore` is not an extension on an empty name: splitting it there would ellipsize to
    // nothing and leave the row showing only a dot.
    expect(splitFileName(".gitignore")).toEqual({ stem: ".gitignore", ext: "" });
    expect(splitFileName("Makefile")).toEqual({ stem: "Makefile", ext: "" });
    expect(splitFileName("src")).toEqual({ stem: "src", ext: "" });
  });
});

describe("Breadcrumbs", () => {
  it("shows the whole path until it has a width to fit it to, the last item split", () => {
    const html = renderStatic(
      createElement(Breadcrumbs, {
        items: [{ label: "." }, { label: "src" }, { label: "rag.ts" }],
        title: "./src/rag.ts",
      }),
    );
    expect(html).toContain('data-tooltip="./src/rag.ts"');
    expect(html).not.toContain("…");
    expect(html.match(/>\/<\/span>/g)).toHaveLength(2);
    expect(html).toContain(">rag</span><span");
    expect(html).toContain(">.ts</span>");
    expect(html).not.toContain("<button");
  });

  it("makes an item that goes somewhere a button", () => {
    const html = renderStatic(
      createElement(Breadcrumbs, {
        items: [{ label: "Workspace", onClick: () => undefined }, { label: "notes" }],
      }),
    );
    expect(html.match(/<button type="button"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>.*>Workspace<\/span><\/button>/);
  });
});
