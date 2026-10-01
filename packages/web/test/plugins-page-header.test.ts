/**
 * The plugins page's header and its buttons, read from the real JSX.
 *
 * The search box lives among the header's actions (PageHeader's title row, which wraps on a
 * narrow screen), the way the Models page lays its header out, and outside the admin-only
 * branch, because a member filters the list too. Every button the page draws carries its copy on the button, not
 * only in aria-label: an icon is followed by its words (hidden while its container is narrow,
 * the Models page's `hidden @3xl:inline`), and each `@3xl:` has an `@container` above it to
 * answer to.
 *
 * Both are layout facts a regex over the file cannot settle (which element the box sits in,
 * whether an `isAdmin &&` encloses it, what a button's children are), so the module is parsed
 * with the TypeScript parser, as `control-size.test.ts` and `company-click-targets.test.ts` do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const PATH = fileURLToPath(new URL("../src/features/plugins/plugins-page.tsx", import.meta.url));
const TEXT = readFileSync(PATH, "utf8");
const SOURCE = ts.createSourceFile(
  PATH,
  TEXT,
  ts.ScriptTarget.Latest,
  /* setParentNodes */ true,
  ts.ScriptKind.TSX,
);

function each(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    each(child, visit);
  });
}

const tagOf = (el: ts.JsxOpeningLikeElement): string => el.tagName.getText();

function attribute(el: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const attr = el.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name,
  );
  const init = attr?.initializer;
  if (init === undefined) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression !== undefined) return init.expression.getText();
  return undefined;
}

function openings(): ts.JsxOpeningLikeElement[] {
  const out: ts.JsxOpeningLikeElement[] = [];
  each(SOURCE, (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
  });
  return out;
}

/** The JSX element that owns an opening tag (the opening itself for a self-closing one). */
const elementOf = (el: ts.JsxOpeningLikeElement): ts.Node =>
  ts.isJsxOpeningElement(el) ? el.parent : el;

/** The nearest enclosing JSX element's opening tag. */
function parentElement(node: ts.Node): ts.JsxOpeningElement | undefined {
  for (let p = node.parent; p !== undefined; p = p.parent) {
    if (ts.isJsxElement(p)) return p.openingElement;
  }
  return undefined;
}

/** The page's `<PageHeader>` (the shared UI package draws its title row, which wraps). */
function pageHeader(): ts.JsxOpeningLikeElement {
  const header = openings().find((el) => tagOf(el) === "PageHeader");
  expect(header, "plugins-page.tsx draws no <PageHeader>").toBeDefined();
  return header!;
}

/** The header's `actions` attribute: what PageHeader lays out at the end of its title row. */
function headerActions(): ts.JsxAttribute {
  const attr = pageHeader().attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === "actions",
  );
  expect(attr, "the <PageHeader> has no actions").toBeDefined();
  return attr!;
}

function searchBoxes(): ts.JsxOpeningLikeElement[] {
  return openings().filter((el) => tagOf(el) === "SearchInput");
}

describe("plugins page header", () => {
  it("holds the one search box, labelled, among the header's actions and outside the admin-only branch", () => {
    const boxes = searchBoxes();
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(attribute(box, "aria-label")).toBe("S.plugins.searchPlaceholder");
    expect(attribute(box, "value")).toBe("query");
    const actions = headerActions();
    let inActions = false;
    for (let p: ts.Node | undefined = box.parent; p !== undefined; p = p.parent) {
      if (p === actions) inActions = true;
      if (
        ts.isBinaryExpression(p) &&
        p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        /\bisAdmin\b/.test(p.left.getText())
      ) {
        throw new Error("the search box is inside an isAdmin branch: members would not see it");
      }
    }
    expect(inActions, "the search box is not among the header's actions").toBe(true);
  });

  it("gives the box the Models header's shape: fixed width at sm, flexible below", () => {
    const wrapper = parentElement(elementOf(searchBoxes()[0]!));
    expect(attribute(wrapper!, "className")?.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "sm:w-56", "sm:flex-none"]),
    );
  });
});

/** The JSX elements a node holds (its own children, any depth, through expressions). */
function openingsUnder(node: ts.Node): ts.JsxOpeningLikeElement[] {
  const out: ts.JsxOpeningLikeElement[] = [];
  each(node, (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
  });
  return out;
}

const classesOf = (el: ts.JsxOpeningLikeElement): string[] =>
  attribute(el, "className")?.split(/\s+/) ?? [];

/** Copy a reader sees: a `{S.…}` child of the button, or of a span inside it that is not sr-only. */
function visibleCopy(button: ts.JsxElement): boolean {
  const holders: ts.Node[] = [
    button,
    ...openingsUnder(button)
      .filter((el) => tagOf(el) === "span" && !classesOf(el).includes("sr-only"))
      .map(elementOf),
  ];
  return holders.some(
    (h) =>
      ts.isJsxElement(h) &&
      h.children.some((c) => ts.isJsxExpression(c) && /\bS\./.test(c.getText())),
  );
}

function buttons(): ts.JsxElement[] {
  return openings()
    .filter((el) => tagOf(el) === "Button" && ts.isJsxOpeningElement(el))
    .map((el) => el.parent as ts.JsxElement);
}

const ICONS = new Set(["GlyphIcon", "StatusIcon"]);

describe("plugins page buttons", () => {
  it("every icon button shows its copy beside the icon, not only in aria-label", () => {
    const withIcon = buttons().filter((b) => openingsUnder(b).some((el) => ICONS.has(tagOf(el))));
    // The header's settings gear, the library card's three, the module row's three.
    expect(withIcon.length).toBeGreaterThanOrEqual(7);
    for (const b of withIcon) {
      const label = attribute(b.openingElement, "aria-label") ?? b.openingElement.getText();
      expect(visibleCopy(b), `icon-only button: ${label}`).toBe(true);
      // The square icon-only form (h-8 w-8 … p-0) has no room for the words.
      expect(classesOf(b.openingElement), label).not.toContain("w-8");
    }
  });

  it("names the Models page's narrow-container rule only where a container answers it", () => {
    const labelled = openings().filter((el) => classesOf(el).some((c) => c.startsWith("@3xl:")));
    expect(labelled.length).toBeGreaterThanOrEqual(7);
    for (const el of labelled) {
      let contained = false;
      for (let p = parentElement(elementOf(el)); p !== undefined; p = parentElement(p.parent)) {
        if (classesOf(p).includes("@container")) {
          contained = true;
          break;
        }
      }
      expect(contained, `no @container above: ${el.parent.getText().slice(0, 80)}`).toBe(true);
    }
  });
});
