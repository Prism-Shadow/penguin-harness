/**
 * Adding a rule on the Project settings security page.
 *
 * The Add button lives in the rule list's header row, above the rules. The form it opens used
 * to render after every rule — and with the factory set seeded the list is already taller than
 * the dialog's 70vh scroll box, so the form opened below the fold and the click looked inert.
 *
 * Where a form opens relative to the control that opens it is a fact about JSX child order, so
 * it is checked with the TypeScript parser the way test/disclosure-anchor.test.ts checks
 * disclosure anchoring — a regex cannot see siblings. The focus half is checked by rendering.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { RuleEditor } from "../src/components/layout/project-dialogs";

const SOURCE = fileURLToPath(
  new URL("../src/components/layout/project-dialogs.tsx", import.meta.url),
);

/**
 * Child slots of the rule list: the `editing === "new"` add form and the `rules.map(…)` rows.
 * Only the list container holds them as two DIFFERENT children — in every ancestor both markers
 * fall inside one and the same child — which is what identifies it without naming it.
 */
function listSlots(): { addForm: number; rows: number } | null {
  const source = ts.createSourceFile(
    SOURCE,
    readFileSync(SOURCE, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const found: { addForm: number; rows: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const holds = (needle: string) => (c: ts.Node) => c.getText(source).includes(needle);
      const addForm = node.children.findIndex(holds('editing === "new"'));
      const rows = node.children.findIndex(holds("rules.map("));
      if (addForm !== -1 && rows !== -1 && addForm !== rows) found.push({ addForm, rows });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.at(-1) ?? null;
}

describe("command policy: adding a rule", () => {
  it("opens the add form above the rules, beside the Add button that opened it", () => {
    const slots = listSlots();
    if (slots === null) throw new Error("add form and rule rows are no longer siblings in a list");
    expect(
      slots.addForm,
      "the add form renders before the rules — appended after them it opens off-screen",
    ).toBeLessThan(slots.rows);
  });

  it("puts the caret in the first field, so the form is not silently opened", () => {
    const html = renderToStaticMarkup(
      createElement(RuleEditor, { initial: null, onApply: () => {}, onCancel: () => {} }),
    );
    // Exactly one field takes focus on mount, and it is the first one — the rule's name.
    expect(html.match(/autofocus/g) ?? []).toHaveLength(1);
    expect(/<input\b[^>]*>/.exec(html)?.[0] ?? "").toContain("autofocus");
  });
});
