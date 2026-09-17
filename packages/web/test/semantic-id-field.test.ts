/**
 * Every create dialog that names an object with a semantic id wears the one shared id field
 * (features/semantic-id/semantic-id-field.tsx), right under the field that names the object:
 * the name is typed first and the id is derived from it on request. The check parses the real
 * JSX with the TypeScript parser, so a dialog that goes back to a bare id `Input`, asks for the
 * wrong kind, or puts the id above the name fails here, naming the file.
 *
 * Plus the one piece of the field's own logic that is not the notice: what goes in a box that
 * draws part of the id in front of itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { proposalValue } from "../src/features/semantic-id/id-suggest-notice";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Each create dialog, the kind its id field asks for, and the label of the field above it. */
const DIALOGS = [
  { file: "components/layout/project-dialogs.tsx", kind: "project", name: "S.project.displayName" },
  { file: "features/agents/agents-page.tsx", kind: "agent", name: "S.common.name" },
  {
    file: "features/benchmark/create-benchmark-modal.tsx",
    kind: "benchmark",
    name: "S.benchmark.titleField",
  },
  { file: "features/company/org-dialogs.tsx", kind: "org", name: "S.company.displayName" },
  {
    file: "features/company/channel-dialogs.tsx",
    kind: "channel",
    name: "S.company.channels.nameField",
  },
] as const;

function jsxTag(node: ts.Node): string | null {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  return null;
}

function attribute(node: ts.Node, name: string): string | null {
  const attrs = ts.isJsxSelfClosingElement(node)
    ? node.attributes
    : ts.isJsxElement(node)
      ? node.openingElement.attributes
      : null;
  const attr = attrs?.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
  const init = attr?.initializer;
  if (init === undefined) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression !== undefined) return init.expression.getText();
  return null;
}

/** Every `<SemanticIdField>` in a file, with the JSX element standing right before it. */
function idFields(file: string): { kind: string | null; previousLabel: string | null }[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(`${SRC}/${file}`, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const found: { kind: string | null; previousLabel: string | null }[] = [];
  const visit = (node: ts.Node): void => {
    if (jsxTag(node) === "SemanticIdField") {
      const siblings = ts.isJsxElement(node.parent) ? node.parent.children : undefined;
      // Comments between the two are `{/* … */}` expressions with nothing in them.
      const elements = (siblings ?? []).filter((c) => jsxTag(c) !== null);
      const previous = elements[elements.indexOf(node as ts.JsxChild) - 1];
      found.push({
        kind: attribute(node, "kind"),
        previousLabel: previous !== undefined ? attribute(previous, "label") : null,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("create dialogs with a semantic id", () => {
  for (const dialog of DIALOGS) {
    it(`${dialog.file} asks for a ${dialog.kind} id, under the field that names it`, () => {
      expect(idFields(dialog.file)).toEqual([{ kind: dialog.kind, previousLabel: dialog.name }]);
    });
  }
});

describe("proposalValue", () => {
  it("fills the box with the proposal as the server answered it", () => {
    expect(proposalValue("report_writer", undefined)).toBe("report_writer");
  });

  it("leaves out the part a non-admin's Project id box draws in front of itself", () => {
    expect(proposalValue("alice-research_lab", "alice-")).toBe("research_lab");
  });

  it("keeps an id that does not start with that part whole, for validation to name", () => {
    expect(proposalValue("research_lab", "alice-")).toBe("research_lab");
  });
});
