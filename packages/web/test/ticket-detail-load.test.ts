/**
 * The ticket detail is revealed only once the names it reads are in.
 *
 * The dialog fetches three things: the ticket itself, the organization's board and its roster.
 * The owner, the parent, the children and every history line render an id until the last two
 * land and a name afterwards — and an id and a name are different lengths, so revealing the
 * ticket on its own reflows the whole panel a moment later, under a reader who has already
 * started reading it. The skeleton therefore waits for both, and the roster's arrival is
 * counted as settled whether it resolved or failed, so a failed fetch opens the dialog on the
 * ids rather than holding the skeleton open for names that are never coming.
 *
 * Gating on the ticket alone is the state this came from and the obvious thing to simplify back
 * to: the extra term looks redundant next to a fetch the code calls best effort. So the shape is
 * parsed rather than trusted to the comment beside it — with the TypeScript parser, since which
 * branch a condition guards is not a question a regex over the file can answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FILE = fileURLToPath(new URL("../src/features/company/ticket-dialog.tsx", import.meta.url));

/** Parse once; both checks ask a question about shape, not about text. */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Whether `name` is called anywhere under `node`. */
function calls(node: ts.Node, name: string): boolean {
  if (ts.isCallExpression(node) && node.expression.getText() === name) return true;
  return node.getChildren().some((child) => calls(child, name));
}

/** Every conditional whose "then" branch renders a `<Skeleton>`, as its condition's source text. */
function skeletonGuards(source: string): string[] {
  const tree = parse(source);
  const guards: string[] = [];
  const rendersSkeleton = (node: ts.Node): boolean => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (node.tagName.getText() === "Skeleton") return true;
    }
    return node.getChildren().some(rendersSkeleton);
  };
  const walk = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node) && rendersSkeleton(node.whenTrue)) {
      guards.push(node.condition.getText());
    }
    ts.forEachChild(node, walk);
  };
  walk(tree);
  return guards;
}

describe("the ticket detail's loading gate", () => {
  const guards = skeletonGuards(readFileSync(FILE, "utf8"));

  it("guards the skeleton on the ticket and on the roster it reads", () => {
    expect(guards).toHaveLength(1);
    const [guard] = guards as [string];
    // The ticket, because there is nothing to show without it.
    expect(guard).toMatch(/detail/);
    // And the roster, because showing the ticket without it is what makes the panel jump.
    expect(guard).toMatch(/contextReady/);
  });

  it("counts the roster as settled even when its fetch fails", () => {
    // The marker belongs in a `finally`, not beside the successful assignment: a failed board or
    // chart fetch has to open the dialog on the ids rather than leave the skeleton pulsing. Asked
    // of the try/finally itself, so moving the call into the `try` fails here even though the
    // word `finally` is still in the file a line above it.
    const tries: ts.TryStatement[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isTryStatement(node)) tries.push(node);
      ts.forEachChild(node, walk);
    };
    walk(parse(readFileSync(FILE, "utf8")));

    const settling = tries.filter((t) => calls(t, "setContextOrg"));
    expect(settling).toHaveLength(1);
    const [statement] = settling as [ts.TryStatement];
    expect(statement.finallyBlock && calls(statement.finallyBlock, "setContextOrg")).toBe(true);
    expect(calls(statement.tryBlock, "setContextOrg")).toBe(false);
  });
});
