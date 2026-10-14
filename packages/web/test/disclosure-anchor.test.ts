/**
 * The rule that decides which disclosure a site gets (the UI package's InfoPopover and
 * HelpFold): **the circled "?" may only appear beside a title, or right of the reading it
 * breaks down.**
 *
 * A "?" is an anchored mark — it reads as help because it modifies the title next to it. Standing
 * alone at the top of a panel it modifies nothing, and a reader has to click it to find out what
 * it even refers to. Where there is no title, the disclosure has to name itself, which is what
 * `HelpFold` is for. A statistic's breakdown is the other anchor: its "?" (`StatHint`) follows
 * the total it splits.
 *
 * This is a rule rather than a preference, so it is checked rather than remembered. The check
 * parses the real JSX with the TypeScript parser instead of matching text: whether a title sits
 * beside a "?" is a question about sibling nodes, and a regex cannot see siblings.
 * Candidate selection must keep unanchored disclosures while ignoring names in comments or text.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { expectEveryRootScanned, expectSingleHome, scanSources } from "./helpers/roots";
import type { SourceFile } from "./helpers/roots";

/** Web and the shared UI package: the rule follows InfoPopover's call sites wherever they live. */
const SCAN = scanSources();

/** Components whose whole job is to render a field's or a section's title. */
const TITLE_ELEMENTS = new Set(["FieldLabel"]);

/**
 * The "?" right of a statistic's total. Its anchor is a reading — a value in an element of its
 * own, often with the "?" in a slot after it so the values of a column stay aligned — rather than
 * title text, so it is held to that shape instead: something comes before it in its row. It is
 * checked where it is placed; its own body, the bare InfoPopover it wraps, is not.
 */
const READING_HINT = "StatHint";
const READING_HINT_HOME = "packages/web/src/components/ui/stat-hint.tsx";

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

/** Does this sibling render anything at all? A reading is an element of its own, not bare text. */
function rendersAnything(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.text.trim() !== "";
  return !ts.isJsxExpression(node) || node.expression !== undefined;
}

/**
 * Is something rendered before a reading's "?" in its row? A slot holding nothing but the "?"
 * stands in for it, so the search moves out to the row around that slot.
 */
function readingAnchored(node: ts.Node): boolean {
  let here = slotIn(node);
  while (here !== null) {
    const { host, slot } = here;
    if (host.children.slice(0, host.children.indexOf(slot as never)).some(rendersAnything)) {
      return true;
    }
    const alone = host.children.every((child) => child === slot || !rendersAnything(child));
    if (!alone || !ts.isJsxElement(host)) return false;
    here = slotIn(host);
  }
  return false;
}

/**
 * Every `<InfoPopover>` in the tree that has no title among its preceding siblings, and every
 * reading's "?" with nothing before it in its row.
 */
function findOrphans(
  files: readonly Pick<SourceFile, "id" | "path" | "text">[] = SCAN.files.filter((f) =>
    f.name.endsWith(".tsx"),
  ),
): string[] {
  const orphans: string[] = [];
  for (const file of files) {
    // The AST compares these tag spellings verbatim; files mentioning neither cannot have a hit.
    if (!file.text.includes("InfoPopover") && !file.text.includes(READING_HINT)) continue;
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const orphan = (node: ts.Node): void => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      orphans.push(`${file.id}:${line}`);
    };
    const visit = (node: ts.Node): void => {
      const tag = jsxTag(node);
      if (tag === "InfoPopover" && file.id !== READING_HINT_HOME) {
        const here = slotIn(node);
        const anchored =
          here !== null &&
          here.host.children
            .slice(0, here.host.children.indexOf(here.slot as never))
            .some(rendersTitle);
        if (!anchored) orphan(node);
      }
      if (tag === READING_HINT && !readingAnchored(node)) orphan(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return orphans.sort();
}

describe("disclosure anchoring", () => {
  it("scans every source root, and finds the two disclosures in one place each", () => {
    expectEveryRootScanned(SCAN);
    expectSingleHome(SCAN, "packages/ui/src/components/overlays/info-popover/info-popover.tsx");
    expectSingleHome(SCAN, "packages/ui/src/components/overlays/info-popover/help-fold.tsx");
  });

  it("never leaves an InfoPopover standing without a title beside it", () => {
    expect(
      findOrphans(),
      'A circled "?" must sit after a title. Where the surface has no title — an Agent settings ' +
        "tab, whose name lives in the tab bar — use HelpFold instead.",
    ).toEqual([]);
  });

  it("actually looks at siblings — the check itself is exercised on a known-orphan shape", () => {
    // Guards the guard: if `rendersTitle`/`slotIn` ever stopped seeing structure, the assertion
    // above would pass on broken code. These are the four shapes that matter.
    const scan = (jsx: string): string[] =>
      findOrphans([{ id: "t.tsx", path: "t.tsx", text: `const x = ${jsx};` }]);
    const anchoredOf = (jsx: string): boolean => scan(jsx).length === 0;
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
    // A reading's "?": after the value, in its element or from a slot of its own; never alone.
    expect(
      anchoredOf("<div><span>{v}</span><span>{h && <StatHint>d</StatHint>}</span></div>"),
    ).toBe(true);
    expect(anchoredOf("<li>{v}{h && <StatHint>d</StatHint>}</li>")).toBe(true);
    expect(anchoredOf('<div className="space-y-4"><span><StatHint>d</StatHint></span></div>')).toBe(
      false,
    );
    expect(scan("<div>Unrelated content</div>")).toEqual([]);
    expect(scan("<div>InfoPopover {/* <StatHint /> */}</div>")).toEqual([]);
  });
});
