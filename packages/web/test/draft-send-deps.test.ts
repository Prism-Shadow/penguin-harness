/**
 * The new-chat page's send (features/chat/draft-view.tsx, `onSend`) reads the draft's picks
 * through a memoised callback, so every piece of state it reads has to be in that callback's
 * dependency list: one left out is read as it was when the callback was last rebuilt.
 *
 * - Every `useState` value the send reads is a dependency. The machine is the case that broke:
 *   a temporary workspace on a machine after a temporary one here leaves the path "" both
 *   times, so nothing else rebuilt the send, and the Session was created on this server.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("../src/features/chat/draft-view.tsx", import.meta.url),
  "utf8",
);

/** The names `const [value, setValue] = useState(…)` declares, anywhere in the file. */
function stateNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText() === "useState"
    ) {
      const first = node.name.elements[0];
      if (first !== undefined && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
        names.add(first.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** `const <name> = useCallback(fn, [deps])`: the callback and its dependency names. */
function memoisedCallback(sf: ts.SourceFile, name: string): { body: ts.Node; deps: string[] } {
  let found: { body: ts.Node; deps: string[] } | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText() === "useCallback"
    ) {
      const [fn, deps] = node.initializer.arguments;
      if (fn !== undefined && deps !== undefined && ts.isArrayLiteralExpression(deps)) {
        found = { body: fn, deps: deps.elements.map((e) => e.getText()) };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found === null) throw new Error(`no useCallback named ${name} in draft-view.tsx`);
  return found;
}

/** The identifiers a node reads, leaving out property names (`body.workspace`, `{ key: … }`). */
function readNames(root: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const propertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!propertyName) names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return names;
}

describe("the draft's send reads the picks as they are now", () => {
  it("lists every piece of state it reads as a dependency", () => {
    const sf = ts.createSourceFile(
      "draft-view.tsx",
      SOURCE,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const state = stateNames(sf);
    const { body, deps } = memoisedCallback(sf, "onSend");
    const read = [...readNames(body)].filter((n) => state.has(n));
    // The machine is among what it reads: the guard would be empty if this stopped matching.
    expect(read).toContain("workspaceMachine");
    expect(read.filter((n) => !deps.includes(n))).toEqual([]);
  });
});
