/**
 * Guard: the notice hook themes restyle (the `ui-notice` box and its icon slot) is written in one
 * place. What NoticeStrip and the toast render is the UI package's to test
 * (packages/ui/test/notice-strip.test.ts, toaster.test.ts).
 *
 * - NoticeStrip and the toaster live in the UI package, one copy each.
 * - No file but NoticeStrip spells the `ui-notice` hook.
 * - A mark a call site draws inside a NoticeStrip sits in its icon slot, so a theme that draws
 *   its own tone mark can hide it (the check is exercised on known shapes too).
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectSingleHome, scanSources } from "./helpers/roots";

const SCAN = scanSources();

const NOTICE_STRIP = "packages/ui/src/components/feedback/notice/notice-strip.tsx";
const TOASTER = "packages/ui/src/components/overlays/toaster/toaster.tsx";

describe("notices", () => {
  it("live in the shared UI package, one copy each", () => {
    expectSingleHome(SCAN, NOTICE_STRIP);
    expectSingleHome(SCAN, TOASTER);
  });

  it("go through NoticeStrip: no other file spells the hook", () => {
    const own = SCAN.files
      .filter((file) => file.name.endsWith(".tsx") && file.id !== NOTICE_STRIP)
      .filter((file) => /\bui-notice\b/.test(file.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")))
      .map((file) => file.id);
    expect(own).toEqual([]);
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
    const hits = SCAN.files.filter((file) => file.name.endsWith(".tsx")).flatMap(unslottedMarks);
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
