/**
 * The company pages carry no whole-area click targets.
 *
 * A card, a row, a heading or a panel is never itself the link — but a row's or a card's *title*
 * is: the title renders as a text button that opens what it names, and the surface around it
 * stays inert (on the ticket board it stays the drag handle). A row with no title of its own
 * carries a small named icon button instead. What the rule rules out is the silently clickable
 * surface, which swallows the controls living inside it and leaves a reader guessing what a
 * click will do. It came out of the company pages, where a whole card, a whole row and a bare
 * heading had each grown a click of its own.
 *
 * The three shapes that smell of it and are mechanically visible: an `onClick` on a host element
 * that is not a control, a `role="button"` / `role="link"` on a container, and a `cursor-pointer`
 * on a surface that is not itself a control. A drift back into any of them is invisible in review
 * — the attribute is just one more line in a long element — so it is parsed rather than
 * remembered, with the TypeScript parser, since whether the handler sits on the `<div>` or on the
 * `<button>` inside it is a question a regex over the file cannot answer.
 *
 * A `<button>` around a title is a control host and passes, which is the point — the check is
 * about where the handler sits, not about whether a surface navigates at all. Out of its reach,
 * and still on the rule: a `<button>` that wraps a whole row (nothing in the syntax says how much
 * of the row it covers), and a click handler passed down as a prop. Those are on the reviewer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * The company modules swept for the rule, relative to `src`. Every page whose surfaces have been
 * gone through belongs here; add one as it is swept, so the list says what has been checked rather
 * than implying the whole feature has.
 */
const MODULES = [
  "features/company/calendar-page.tsx",
  "features/company/chart-card.tsx",
  "features/company/channel-view.tsx",
  "features/company/finance-page.tsx",
  "features/company/handbook-explorer.tsx",
  "features/company/handbook-page.tsx",
  "features/company/org-chart-page.tsx",
  "features/company/org-layout.tsx",
  "features/company/overview-page.tsx",
  "features/company/shared.tsx",
  "features/company/ticket-dialog.tsx",
  "features/company/tickets-page.tsx",
  "features/proposals/proposals-page.tsx",
];

/** Host elements that are controls already: a click on one of these is what the element is for. */
const CONTROLS = new Set([
  "a",
  "button",
  "input",
  "label",
  "option",
  "select",
  "summary",
  "textarea",
]);

/**
 * Declared exceptions: an `onClick` on a container that delegates for the interactive elements
 * *inside* it rather than being a target of its own — the handbook's rendered Markdown catches
 * clicks on the anchors it drew, so a relative link opens in the pane instead of a new tab. Keyed
 * by module and by the handler's own text, both of which survive the line moving.
 */
const DELEGATES = new Map<string, ReadonlySet<string>>([
  ["features/company/handbook-page.tsx", new Set(["onBodyClick"])],
]);

function openingElement(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) return node;
  return null;
}

/** A host element is a lowercase tag; `<OrgSection>` is a component and owns its own markup. */
const isHostElement = (el: ts.JsxOpeningLikeElement): boolean =>
  /^[a-z]/.test(el.tagName.getText());

function attribute(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText() === name,
  );
}

/**
 * Every literal chunk of a `className`. A template literal's interpolations are skipped: a class
 * reached through a shared constant is that constant's business, and the constants themselves are
 * in these same modules.
 */
function literalChunks(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) out.push(span.literal.text);
  } else {
    // The callback must return nothing: forEachChild stops at the first truthy result.
    ts.forEachChild(node, (child) => {
      literalChunks(child, out);
    });
  }
  return out;
}

/** Whole-area click targets, as "relative/path:line <tag> — what it is". */
function findWholeAreaTargets(): string[] {
  const found: string[] = [];
  for (const rel of MODULES) {
    const path = `${SRC}/${rel}`;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const delegates = DELEGATES.get(rel) ?? new Set<string>();
    const report = (el: ts.JsxOpeningLikeElement, why: string) => {
      const line = source.getLineAndCharacterOfPosition(el.getStart(source)).line + 1;
      found.push(`${rel}:${line} <${el.tagName.getText()}> — ${why}`);
    };
    const visit = (node: ts.Node): void => {
      const el = openingElement(node);
      if (el !== null && isHostElement(el)) {
        const tag = el.tagName.getText();
        const onClick = attribute(el, "onClick");
        if (onClick !== undefined && !CONTROLS.has(tag)) {
          const handler = onClick.initializer?.getText() ?? "";
          const named = handler.replaceAll(/[{}]/g, "").trim();
          if (!delegates.has(named)) report(el, "onClick on a surface that is not a control");
        }
        const role = attribute(el, "role")?.initializer?.getText();
        if ((role === '"button"' || role === '"link"') && !CONTROLS.has(tag)) {
          report(el, `${role} on a container`);
        }
        const className = attribute(el, "className");
        if (
          className?.initializer !== undefined &&
          !CONTROLS.has(tag) &&
          literalChunks(className.initializer).some((chunk) => /\bcursor-pointer\b/.test(chunk))
        ) {
          report(el, "cursor-pointer on a surface that is not a control");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found.sort();
}

describe("company pages", () => {
  it("navigate through named controls, never through a whole card, row or panel", () => {
    expect(findWholeAreaTargets()).toEqual([]);
  });
});
