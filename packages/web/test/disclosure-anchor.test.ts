/**
 * The rule that decides which disclosure a site gets (src/components/ui/info-popover.tsx and
 * help-fold.tsx): **the circled "?" may only appear beside a title.**
 *
 * A "?" is an anchored mark — it reads as help because it modifies the title next to it. Standing
 * alone at the top of a panel it modifies nothing, and a reader has to click it to find out what
 * it even refers to. Where there is no title, the disclosure has to name itself, which is what
 * `HelpFold` is for.
 *
 * This is a rule rather than a preference, so it is checked rather than remembered. The check
 * parses the real JSX with the TypeScript parser instead of matching text: whether a title sits
 * beside a "?" is a question about sibling nodes, and a regex cannot see siblings.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Components whose whole job is to render a field's or a section's title. */
const TITLE_ELEMENTS = new Set(["FieldLabel"]);

function tsxFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const jsxTag = (node: ts.Node): string | null => {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  return null;
};

/**
 * Does this sibling put a title on screen? Text and an interpolated expression both do. A nested
 * element does only when it is one of the title components — a `<Button>` beside a "?" is not a
 * title, it is just another control sharing the row.
 */
function rendersTitle(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.text.trim() !== "";
  // `{/* a comment */}` parses as a JsxExpression with no expression: it renders nothing.
  if (ts.isJsxExpression(node)) return node.expression !== undefined;
  const tag = jsxTag(node);
  return tag !== null && TITLE_ELEMENTS.has(tag);
}

/**
 * The JSX child slot this node occupies, and the element holding it. A "?" is often wrapped in a
 * conditional (`{!isOwner && <InfoPopover …/>}`), so the slot is the outermost node whose own
 * parent is the enclosing element, not the "?" itself.
 */
function slotIn(node: ts.Node): { host: ts.JsxElement | ts.JsxFragment; slot: ts.Node } | null {
  let slot: ts.Node = node;
  while (slot.parent !== undefined) {
    const host = slot.parent;
    if (ts.isJsxElement(host) || ts.isJsxFragment(host)) return { host, slot };
    slot = host;
  }
  return null;
}

/** Every `<InfoPopover>` in the tree that has no title among its preceding siblings. */
function findOrphans(): string[] {
  const orphans: string[] = [];
  for (const path of tsxFiles()) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (jsxTag(node) === "InfoPopover") {
        const here = slotIn(node);
        const anchored =
          here !== null &&
          here.host.children
            .slice(0, here.host.children.indexOf(here.slot as never))
            .some(rendersTitle);
        if (!anchored) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          orphans.push(`${path.slice(SRC.length + 1).replaceAll(sep, "/")}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return orphans.sort();
}

describe("disclosure anchoring", () => {
  it("never leaves an InfoPopover standing without a title beside it", () => {
    expect(
      findOrphans(),
      'A circled "?" must sit after a title. Where the surface has no title — an Agent settings ' +
        "tab, whose name lives in the tab bar — use HelpFold (components/ui/help-fold.tsx) instead.",
    ).toEqual([]);
  });

  it("actually looks at siblings — the check itself is exercised on a known-orphan shape", () => {
    // Guards the guard: if `rendersTitle`/`slotIn` ever stopped seeing structure, the assertion
    // above would pass on broken code. These are the four shapes that matter.
    const parse = (jsx: string) =>
      ts.createSourceFile(
        "t.tsx",
        `const x = ${jsx};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    const anchoredOf = (jsx: string): boolean => {
      const source = parse(jsx);
      let result = false;
      const visit = (node: ts.Node): void => {
        if (jsxTag(node) === "InfoPopover") {
          const here = slotIn(node);
          result =
            here !== null &&
            here.host.children
              .slice(0, here.host.children.indexOf(here.slot as never))
              .some(rendersTitle);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return result;
    };
    // A title beside it, plain and interpolated, and through a conditional wrapper.
    expect(anchoredOf("<h1>Vault<InfoPopover>d</InfoPopover></h1>")).toBe(true);
    expect(anchoredOf("<h1>{title}<InfoPopover>d</InfoPopover></h1>")).toBe(true);
    expect(anchoredOf("<h1>{title}{ok && <InfoPopover>d</InfoPopover>}</h1>")).toBe(true);
    expect(
      anchoredOf("<span><FieldLabel>{l}</FieldLabel><InfoPopover>d</InfoPopover></span>"),
    ).toBe(true);
    // Alone in a stack; preceded only by a comment; and beside a control that is not a title.
    expect(anchoredOf('<div className="space-y-4"><InfoPopover>d</InfoPopover></div>')).toBe(false);
    expect(anchoredOf("<div>{/* why */}<InfoPopover>d</InfoPopover></div>")).toBe(false);
    expect(anchoredOf("<div><InfoPopover>d</InfoPopover><Button>Import</Button></div>")).toBe(
      false,
    );
  });
});
