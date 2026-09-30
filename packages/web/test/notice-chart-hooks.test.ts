/**
 * The notice and chart hooks on the real app: every notice strip renders through NoticeStrip
 * (so it carries `ui-notice` and a `data-tone` in the hook's words), toasts carry the same hook,
 * and the charts' roots carry `ui-chart` with their parts named by literal `data-part` values.
 */
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOTICE_TONE, NoticeStrip } from "../src/components/ui/notice-strip";
import { scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();
const text = (id: string) => sourceFile(SCAN, `packages/web/src/${id}`).text;

describe("notices", () => {
  it("render the hook with the tone in the hook's words", () => {
    const html = renderToStaticMarkup(
      createElement(NoticeStrip, { tone: "attention", className: "px-3" }, "Heads up"),
    );
    expect(html).toContain("ui-notice");
    expect(html).toContain('data-tone="warning"');
    expect(new Set(Object.values(NOTICE_TONE))).toEqual(
      new Set(["info", "success", "warning", "danger", "neutral"]),
    );
  });

  it("go through NoticeStrip, and toasts carry the hook too", () => {
    const inline = SCAN.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .filter((file) => !file.id.endsWith("components/ui/notice-strip.tsx"))
      .filter((file) => /toneStrip[.[]/.test(file.text.replace(/\/\*[\s\S]*?\*\//g, "")))
      .map((file) => file.id);
    expect(inline).toEqual([]);
    expect(text("components/ui/toast.tsx")).toContain("ui-notice");
  });
});

/** Icon renderers: a mark drawn by one of these is a glyph, not words. */
const ICON_TAG = /^(?:GlyphIcon|Glyph|\w+Icon)$/;

/**
 * Leading marks inside a NoticeStrip that do not sit in `data-slot="icon"`: a self-closing,
 * aria-hidden span (a dot) or an icon renderer, outside any button or link (an action's own
 * glyph is not the notice's mark). Frost and Console draw their own tone mark and hide the slot,
 * so a mark outside it would show twice.
 */
function unslottedMarks(file: { path: string; text: string; id: string }): string[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hits: string[] = [];
  const tagOf = (n: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(source);
  const attrsOf = (n: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(n) ? n.openingElement : n).attributes;
  const has = (n: ts.JsxElement | ts.JsxSelfClosingElement, name: string, value?: string) =>
    attrsOf(n).properties.some(
      (a) =>
        ts.isJsxAttribute(a) &&
        a.name.getText(source) === name &&
        (value === undefined || a.initializer?.getText(source) === `"${value}"`),
    );
  const walk = (node: ts.Node, slotted: boolean, inAction: boolean): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagOf(node);
      const slot = slotted || has(node, "data-slot", "icon");
      const action = inAction || /^(?:button|a|Button)$/.test(tag);
      const dot = ts.isJsxSelfClosingElement(node) && tag === "span" && has(node, "aria-hidden");
      if (!slot && !action && (dot || ICON_TAG.test(tag))) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        hits.push(`${file.id}:${line} <${tag}> in a NoticeStrip without data-slot="icon"`);
      }
      ts.forEachChild(node, (child) => walk(child, slot, action));
      return;
    }
    ts.forEachChild(node, (child) => walk(child, slotted, inAction));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && tagOf(node) === "NoticeStrip") {
      for (const child of node.children) walk(child, false, false);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("a notice's own mark", () => {
  it("sits in the icon slot, so a theme that draws its own can hide it", () => {
    const hits = SCAN.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .flatMap(unslottedMarks);
    expect(hits).toEqual([]);
  });

  it("is found on known shapes", () => {
    const check = (text: string) => unslottedMarks({ path: "/v/a.tsx", id: "a.tsx", text });
    expect(
      check(
        'const A = () => <NoticeStrip tone="danger"><span aria-hidden className="dot" />x</NoticeStrip>;',
      ),
    ).toHaveLength(1);
    expect(
      check(
        'const A = () => <NoticeStrip tone="danger"><p><GlyphIcon d={D} />x</p></NoticeStrip>;',
      ),
    ).toHaveLength(1);
    expect(
      check(
        'const A = () => <NoticeStrip tone="danger"><span data-slot="icon"><GlyphIcon d={D} /></span>x</NoticeStrip>;',
      ),
    ).toEqual([]);
    expect(
      check(
        'const A = () => <NoticeStrip tone="danger">x<Button><CloseIcon /></Button></NoticeStrip>;',
      ),
    ).toEqual([]);
  });
});

describe("charts", () => {
  it("carry ui-chart on their roots and name their parts", () => {
    for (const id of [
      "features/usage/chart-svg.tsx",
      "components/ui/token-donut.tsx",
      "features/benchmark/score-sparkline.tsx",
    ]) {
      expect(text(id), id).toContain("ui-chart");
    }
    const parts = ["features/usage/trend-chart.tsx", "features/usage/usage-charts.tsx"]
      .map(text)
      .join("\n");
    for (const part of ["series", "area", "bar", "point"]) {
      expect(parts).toContain(`data-part="${part}"`);
    }
    expect(text("features/usage/chart-svg.tsx")).toContain('data-part="grid"');
  });
});
