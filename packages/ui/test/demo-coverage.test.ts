/**
 * Every component ships a gallery demo beside it (A-architecture §6.4).
 *
 * The gallery is where a theme is reviewed: a component with no `*.demo.tsx` is a component no
 * theme was ever looked at on, and it drifts first. The rule is structural — a directory under
 * src/components that holds a component module also holds a demo — so it is checked on the tree
 * rather than remembered in review.
 *
 * A component module is a `.tsx` file (not a demo, not a test) that exports a capitalised binding.
 * Until the first component lands, the rule has nothing to check and says so as a skipped case.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scanSourceRoots } from "../src/testing";
import { REPO_ROOT, SRC_DIR } from "./helpers/paths";

const COMPONENTS_DIR = join(SRC_DIR, "components");

/**
 * Component directories (relative to src/components) excused from having a demo, each with its
 * reason. Starts empty; an entry that stops being needed fails the suite until it is removed.
 */
const DEMO_EXEMPT: ReadonlyMap<string, string> = new Map<string, string>([
  [
    "icons/spinner",
    "W1: the one Spinner landed early because rule 11 gives `animate-spin` this file and the " +
      "screens needed it (#763); its demo lands with the rest of the component set, which is the " +
      "PR that also gives the gallery a module to reach it through",
  ],
]);

/** Exported names starting with a capital letter — the shape of a component export. */
function exportedComponents(text: string): string[] {
  const source = ts.createSourceFile(
    "m.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names: string[] = [];
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      exported(statement)
    ) {
      if (statement.name !== undefined) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.push(element.name.text);
      }
    }
  }
  return names.filter((name) => /^[A-Z][A-Za-z0-9]*$/.test(name) && !/^[A-Z0-9_]+$/.test(name));
}

/** Directory (relative to src/components) → does it hold a component module, a demo? */
function componentDirectories(): Map<string, { component: boolean; demo: boolean }> {
  const scan = scanSourceRoots(
    { components: COMPONENTS_DIR },
    { repoRoot: REPO_ROOT, extensions: [".tsx"] },
  );
  const dirs = new Map<string, { component: boolean; demo: boolean }>();
  for (const file of scan.files) {
    const dir = file.rel.includes("/") ? file.rel.slice(0, file.rel.lastIndexOf("/")) : ".";
    const entry = dirs.get(dir) ?? { component: false, demo: false };
    if (file.name.endsWith(".demo.tsx")) entry.demo = true;
    else if (!/\.test\.tsx$/.test(file.name) && exportedComponents(file.text).length > 0) {
      entry.component = true;
    }
    dirs.set(dir, entry);
  }
  return dirs;
}

describe("gallery demos", () => {
  const active = existsSync(COMPONENTS_DIR);
  const dirs = active
    ? componentDirectories()
    : new Map<string, { component: boolean; demo: boolean }>();
  const withComponents = [...dirs].filter(([, entry]) => entry.component);

  if (!active || withComponents.length === 0) {
    it.skip("src/components — PENDING, no component modules yet: every component directory will need a *.demo.tsx", () => {});
  } else {
    it("sit beside every component", () => {
      const missing = withComponents
        .filter(([dir, entry]) => !entry.demo && !DEMO_EXEMPT.has(dir))
        .map(([dir]) => `src/components/${dir}`);
      expect(
        missing,
        "Add a <name>.demo.tsx next to the component so the gallery renders it.",
      ).toEqual([]);
    });
  }

  it("carries no exemption that has stopped being needed", () => {
    const stale = [...DEMO_EXEMPT.keys()].filter((dir) => {
      const entry = dirs.get(dir);
      return entry === undefined || !entry.component || entry.demo;
    });
    expect(stale).toEqual([]);
  });

  it("recognizes a component module — the check is exercised on known sources", () => {
    expect(exportedComponents("export function Button() { return null; }")).toEqual(["Button"]);
    expect(exportedComponents("export const Badge = () => null;")).toEqual(["Badge"]);
    expect(exportedComponents("function Card() {}\nexport { Card };")).toEqual(["Card"]);
    // Hooks, constants and private helpers are not components.
    expect(
      exportedComponents(
        "export function useCopied() {}\nexport const ICON_SIZE = {};\nfunction Inner() {}",
      ),
    ).toEqual([]);
  });
});
