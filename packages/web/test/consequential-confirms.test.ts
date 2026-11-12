/**
 * Guard: a consequential action is reached only through its confirmation.
 *
 * Each entry names a module and the function in it that does the consequential thing — removes
 * a member, restores the default command rules, deletes a machine from the Project, stops a
 * machine's server, uninstalls the program from a machine or installs it there again, stops a
 * running process, runs a plugin's action, clears an organization draft, deletes an
 * organization (and by default its Agents), syncs the model presets, revokes a paired Chrome,
 * deletes an archived conversation from its stub or the archive page. Every reference to that
 * function must sit inside a `ConfirmModal`'s `onConfirm`: directly, or in the body of a
 * function that `onConfirm` names. A button wired straight back to the action is one short line
 * in a long element and reads fine in review, so the JSX is parsed rather than remembered.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { expectEveryRootScanned, scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();

/**
 * [module under packages/web/src, the function only a confirmation may call], for the actions
 * no rendered scenario holds yet. An action leaves this list once a click scenario holds it
 * (confirm-first.test.ts, or the surface's own suite: agent-workbenches.test.ts for a restore),
 * and the list is meant to empty.
 */
const GUARDED: ReadonlyArray<readonly [string, string]> = [
  ["features/projects/project-dialogs/members-section.tsx", "doRemove"],
  ["features/projects/project-dialogs/security-policy-section.tsx", "restoreDefaults"],
  ["features/machines/machines-page.tsx", "deleteMachine"],
  ["features/machines/machines-page.tsx", "stopServer"],
  ["features/machines/machines-page.tsx", "uninstall"],
  ["features/machines/machines-page.tsx", "reinstall"],
  ["features/chat/session/main-chat-dialogs.tsx", "onKillProcess"],
  ["features/settings/plugins-section.tsx", "runAction"],
  ["features/company/org-dialogs.tsx", "dropDraft"],
  ["features/company/org-dialogs.tsx", "doDelete"],
  ["features/models/preset-sync.tsx", "runPresetSync"],
  ["features/settings/browser-section.tsx", "revokeChrome"],
  ["features/chat/archived-session-stub.tsx", "remove"],
  ["features/settings/archived-sessions-section.tsx", "deletePending"],
];

const isOnConfirm = (node: ts.Node): node is ts.JsxAttribute =>
  ts.isJsxAttribute(node) && node.name.getText() === "onConfirm";

/**
 * The references to `action`: those outside a confirmation as "module:line", and how many sit
 * inside one — none at all means the entry names a function that was renamed or removed.
 */
function references(file: string, action: string): { unguarded: string[]; confirmed: number } {
  const src = sourceFile(SCAN, `packages/web/src/${file}`);
  const sf = ts.createSourceFile(
    src.path,
    src.text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  // `onConfirm={run}`: the body of `run` counts as inside the confirmation.
  const named = new Set<string>();
  const collect = (node: ts.Node): void => {
    const expr =
      isOnConfirm(node) && node.initializer && ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : undefined;
    if (expr !== undefined && ts.isIdentifier(expr)) named.add(expr.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const confirmed = (node: ts.Node): boolean => {
    for (let n = node.parent; n !== undefined; n = n.parent) {
      if (isOnConfirm(n)) return true;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && named.has(n.name.text)) {
        return true;
      }
    }
    return false;
  };
  const unguarded: string[] = [];
  let inside = 0;
  const visit = (node: ts.Node): void => {
    const p = node.parent;
    // A declaration (a prop's type member and its destructured parameter included), a member
    // name (`S.machines.stopUsing`) or a key is not a call site.
    const notReference =
      p !== undefined &&
      ((ts.isVariableDeclaration(p) && p.name === node) ||
        (ts.isFunctionDeclaration(p) && p.name === node) ||
        (ts.isPropertySignature(p) && p.name === node) ||
        (ts.isBindingElement(p) && p.name === node) ||
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node));
    if (ts.isIdentifier(node) && node.text === action && !notReference) {
      if (confirmed(node)) inside += 1;
      else unguarded.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { unguarded, confirmed: inside };
}

describe("consequential actions confirm first", () => {
  it("scans every source root", () => {
    expectEveryRootScanned(SCAN);
  });

  it.each(GUARDED)("%s calls %s only from a ConfirmModal's onConfirm", (file, action) => {
    const { unguarded, confirmed } = references(file, action);
    expect(confirmed, `${file} no longer confirms ${action}`).toBeGreaterThan(0);
    expect(unguarded).toEqual([]);
  });
});
