/**
 * Components never branch on which theme is active (A-architecture §3, §4).
 *
 * Every theme renders the same component with the same props and the same markup; a theme differs
 * only in the values of the `--ui-*` tokens and in what its CSS does with the closed list of style
 * hooks. A component that asks for the theme id — to pick a class, swap an icon, skip a wrapper —
 * forks the component per theme, and the fork is invisible from the gallery page of any single
 * theme. So the source is parsed for the ways a theme id can be read in JS, and each is refused
 * outside the modules whose job the theme id is.
 *
 * Refused: the identifiers that carry the id (`useTheme`, `themeId`, `ThemeId`, `THEME_IDS`,
 * `DEFAULT_THEME_ID`), any string or template text naming `data-theme` (an attribute read, a
 * selector, or a `[data-theme=…]:` class variant), a JSX `data-theme` attribute, and
 * `dataset.theme`. Comments are not code and are not scanned.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scanSourceRoots, unscannedRoots } from "../src/testing";
import { REPO_ROOT, SRC_DIR } from "./helpers/paths";

/**
 * Modules whose job is the theme id, relative to src/. The contract names the ids, the boot script
 * applies them, and the test helpers read the theme files by id. Nothing a component imports.
 */
const THEME_MACHINERY: readonly string[] = ["tokens.ts", "boot.ts", "testing/"];

const THEME_IDENTIFIERS = new Set([
  "useTheme",
  "themeId",
  "ThemeId",
  "THEME_IDS",
  "DEFAULT_THEME_ID",
]);

function themeReads(text: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(
    "probe.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const report = (node: ts.Node, what: string) =>
    found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${what}`);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && THEME_IDENTIFIERS.has(node.text)) {
      report(node, node.text);
    } else if (
      (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
      node.text.includes("data-theme")
    ) {
      report(node, `"${node.text}"`);
    } else if (ts.isJsxAttribute(node) && node.name.getText(source) === "data-theme") {
      report(node, "data-theme attribute");
    } else if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "theme" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "dataset"
    ) {
      report(node, "dataset.theme");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("theme reads", () => {
  const scan = scanSourceRoots(
    { ui: SRC_DIR },
    { repoRoot: REPO_ROOT, extensions: [".ts", ".tsx"] },
  );

  it("scans the package source", () => {
    expect(unscannedRoots(scan)).toEqual([]);
  });

  it("are confined to the theme machinery", () => {
    const reads = scan.files
      .filter(
        (file) =>
          !THEME_MACHINERY.some((allowed) => file.rel === allowed || file.rel.startsWith(allowed)),
      )
      .flatMap((file) => themeReads(file.text).map((hit) => `${file.id}:${hit}`));
    expect(
      reads,
      "A component renders the same for every theme; express the difference as a token or a " +
        "declared style hook in the theme CSS instead.",
    ).toEqual([]);
  });

  it("keeps its allow-list pointing at modules that exist", () => {
    for (const allowed of THEME_MACHINERY) {
      expect(
        scan.files.some((file) => file.rel === allowed || file.rel.startsWith(allowed)),
        `${allowed} is allow-listed but no longer exists`,
      ).toBe(true);
    }
  });

  it("recognizes each refused shape — the check is exercised on known sources", () => {
    expect(themeReads("const { themeId } = useTheme();")).toEqual(["1: themeId", "1: useTheme"]);
    expect(themeReads('import type { ThemeId } from "../../tokens";')).toEqual(["1: ThemeId"]);
    expect(themeReads("const t = document.documentElement.dataset.theme;")).toEqual([
      "1: dataset.theme",
    ]);
    expect(themeReads('const t = root.getAttribute("data-theme");')).toEqual(['1: "data-theme"']);
    expect(themeReads("const c = `px-2 [[data-theme=geek]_&]:rounded-none ${x}`;")).toEqual([
      '1: "px-2 [[data-theme=geek]_&]:rounded-none "',
    ]);
    expect(themeReads('const e = <div data-theme="modern" />;')).toEqual([
      "1: data-theme attribute",
    ]);
    // Reading a token's value, a comment naming the attribute, and a prop named `theme` for
    // something else (a code block's language theme) are all fine.
    expect(
      themeReads(
        [
          "// the theme lives in data-theme on <html>; never read it here",
          'const w = getComputedStyle(el).getPropertyValue("--ui-icon-stroke");',
          "const block = <CodeBlock theme={shikiTheme} />;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
