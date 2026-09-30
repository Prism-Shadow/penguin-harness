/**
 * No native `title` tooltips in the Web App.
 *
 * Every hover hint shows in the shared tooltip (the UI package's overlays/tooltip/tooltip.tsx,
 * whose own tests read a `data-tooltip` request): through `data-tooltip` on the element, read by
 * the one `TooltipLayer`, or a `<Tooltip>` wrapper. A native `title` waits about a second, cannot
 * be themed and never shows on keyboard focus, so one left behind is a hint that looks and
 * behaves unlike every other in the app.
 *
 * The check parses the real JSX with the TypeScript parser, because whether `title` is an
 * attribute of a DOM element or a prop of a component (a Modal's heading, an EmptyState's) is a
 * question about the element it sits on, which a regex cannot answer. It fails on a `title`
 * attribute of an intrinsic element, written directly or inside a spread object literal.
 * Components that pass their own props through to a DOM element (Button, Input, Switch) turn
 * `title` into `data-tooltip` themselves.
 *
 * Exempt, because the platform needs them: `<iframe title>`, which names the frame to
 * assistive technology and shows no tooltip; and an SVG `<title>` child, which is an element,
 * not this attribute (the app's own icons use `data-tooltip` on the `<svg>` instead).
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";
import type { SourceFile } from "./helpers/roots";

/** Intrinsic elements whose `title` the platform needs. */
const TITLE_ALLOWED_ON = new Set(["iframe"]);

function nativeTitles(file: Pick<SourceFile, "path" | "text" | "id">): string[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const hits: string[] = [];
  const at = (node: ts.Node) =>
    `${file.id}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const intrinsic = /^[a-z][\w-]*$/.test(tag);
      if (intrinsic && !TITLE_ALLOWED_ON.has(tag)) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(source) === "title") {
            hits.push(`${at(attr)} <${tag} title>`);
          }
          if (ts.isJsxSpreadAttribute(attr)) {
            const spreadTitle = (n: ts.Node): void => {
              if (
                (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
                n.name.getText(source).replace(/["']/g, "") === "title"
              ) {
                hits.push(`${at(n)} <${tag} {...{ title }}>`);
              }
              ts.forEachChild(n, spreadTitle);
            };
            spreadTitle(attr.expression);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** Form controls take their name from a label element, which a static check cannot follow. */
const NAMED_BY_LABEL = new Set(["input", "textarea", "select"]);

/** Components that render marks, never words: an element holding only these has no text. */
const WORDLESS_COMPONENT = /^(?:\w*Icon|\w*Glyph\w*|Chevron\w*|\w*Avatar|UpdateDot|StatusIcon)$/;

type JsxTagged = ts.JsxElement | ts.JsxSelfClosingElement;

const openingOf = (node: JsxTagged) => (ts.isJsxElement(node) ? node.openingElement : node);

/** Whether an attribute list sets `name`, directly or in a spread object literal. */
function sets(attributes: ts.JsxAttributes, names: readonly string[], source: ts.SourceFile) {
  return attributes.properties.some((attr) => {
    if (ts.isJsxAttribute(attr)) return names.includes(attr.name.getText(source));
    if (!ts.isJsxSpreadAttribute(attr)) return false;
    let found = false;
    const walk = (n: ts.Node): void => {
      if (
        (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
        names.includes(n.name.getText(source).replace(/["']/g, ""))
      ) {
        found = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(attr.expression);
    return found;
  });
}

/** A spread of something other than an object literal: it may set anything, a name included. */
const opaqueSpread = (attributes: ts.JsxAttributes) =>
  attributes.properties.some(
    (attr) =>
      ts.isJsxSpreadAttribute(attr) &&
      !ts.isObjectLiteralExpression(attr.expression) &&
      !ts.isParenthesizedExpression(attr.expression),
  );

/** Whether the children put words (or a named element) in front of assistive technology. */
function hasContent(children: ts.NodeArray<ts.JsxChild>, source: ts.SourceFile): boolean {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.getText(source).trim() !== "";
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    if (ts.isJsxFragment(child)) return hasContent(child.children, source);
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const opening = openingOf(child);
      const tag = opening.tagName.getText(source);
      if (!/^[a-z]/.test(tag)) return !WORDLESS_COMPONENT.test(tag);
      if (sets(opening.attributes, ["aria-label", "aria-labelledby"], source)) return true;
      return ts.isJsxElement(child) && hasContent(child.children, source);
    }
    return false;
  });
}

/**
 * Elements whose hint is their only name: a `data-tooltip` on an element with no words in it
 * and no aria-label. The shared tooltip names nothing to assistive technology, so such an
 * element reads as unlabeled. An element inside an aria-hidden or role="img" ancestor is part
 * of a named or hidden whole, and is not asked for a name of its own.
 */
function unnamedHints(file: Pick<SourceFile, "path" | "text" | "id">): string[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const hits: string[] = [];
  const insideNamedWhole = (node: ts.Node): boolean => {
    for (let up = node.parent; up !== undefined; up = up.parent) {
      if (ts.isJsxElement(up)) {
        const attrs = up.openingElement.attributes;
        if (sets(attrs, ["aria-hidden"], source)) return true;
        const role = attrs.properties.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText(source) === "role",
        );
        if (role !== undefined && role.getText(source).includes('"img"')) return true;
      }
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = openingOf(node);
      const tag = opening.tagName.getText(source);
      const attrs = opening.attributes;
      if (
        /^[a-z]/.test(tag) &&
        !NAMED_BY_LABEL.has(tag) &&
        sets(attrs, ["data-tooltip"], source) &&
        !sets(attrs, ["aria-label", "aria-labelledby", "aria-hidden"], source) &&
        !opaqueSpread(attrs) &&
        !(ts.isJsxElement(node) && hasContent(node.children, source)) &&
        !insideNamedWhole(node)
      ) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        hits.push(`${file.id}:${line} <${tag} data-tooltip> with no words and no aria-label`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("native title tooltips", () => {
  const scan = scanSources();

  it("are not used anywhere in the web app", () => {
    expectEveryRootScanned(scan);
    const hits = scan.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .flatMap(nativeTitles);
    expect(
      hits,
      "Use data-tooltip (read by TooltipLayer) or <Tooltip>, and an aria-label where the title " +
        "was the element's only name.",
    ).toEqual([]);
  });

  it("leave no element whose hint was its only name without an aria-label", () => {
    const hits = scan.files
      .filter((file) => file.root === "web" && file.name.endsWith(".tsx"))
      .flatMap(unnamedHints);
    expect(
      hits,
      "A data-tooltip names nothing to assistive technology: give a wordless element an " +
        "aria-label (namedHint() in tooltip.tsx does both for a mark), or show the words.",
    ).toEqual([]);
  });

  it("are found on known shapes, and a component's title prop is left alone", () => {
    const check = (text: string) => nativeTitles({ path: "/virtual/a.tsx", id: "a.tsx", text });
    expect(check('const A = () => <span title="x">y</span>;')).toHaveLength(1);
    expect(check("const A = () => <button {...(on ? { title: t } : {})} />;")).toHaveLength(1);
    expect(check("const A = () => <div {...{ title }} />;")).toHaveLength(1);
    expect(check('const A = () => <Modal title="Heading" />;')).toEqual([]);
    expect(check('const A = () => <iframe title="Preview" />;')).toEqual([]);
    expect(check('const A = () => <span data-tooltip="x" aria-label="x" />;')).toEqual([]);
  });

  it("asks a wordless hinted element for a name, and nothing more", () => {
    const check = (text: string) => unnamedHints({ path: "/virtual/a.tsx", id: "a.tsx", text });
    expect(
      check('const A = () => <button data-tooltip="Copy"><CopyIcon /></button>;'),
    ).toHaveLength(1);
    expect(check('const A = () => <span data-tooltip="Queued" className="dot" />;')).toHaveLength(
      1,
    );
    expect(
      check('const A = () => <button data-tooltip="Copy" aria-label="Copy"><CopyIcon /></button>;'),
    ).toEqual([]);
    expect(check('const A = () => <button data-tooltip="More">{label}</button>;')).toEqual([]);
    expect(check('const A = () => <span {...namedHint("Bar 3")} />;')).toEqual([]);
    expect(
      check(
        'const A = () => <div role="img" aria-label="Board"><span data-tooltip="Open 3" /></div>;',
      ),
    ).toEqual([]);
  });
});
