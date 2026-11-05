/**
 * The package never reaches for the web app's dictionaries (A-architecture §3.15).
 *
 * Copy is the caller's: a title, a label, an empty-state sentence arrive as props, and only the
 * handful of accessibility strings a primitive needs when a caller forgets come from the package's
 * own `UiStrings` defaults. The failure this guards is quiet — importing `S` from the web app
 * compiles, renders the right words in the app, and breaks only in the gallery and the tests, where
 * nobody has set the active dictionary — so it is parsed rather than remembered.
 *
 * Three shapes are refused anywhere under packages/ui/src: an import or re-export (static, dynamic
 * or `require`) whose specifier resolves outside packages/ui — which is how `../../web/src/lib/strings`
 * would arrive — or names the web package; a specifier ending in the web's dictionary modules
 * (`lib/strings`, `strings-en`); and a member access on an identifier `S`, the web's dictionary
 * binding, whatever it was imported from.
 */
import { dirname, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scanSourceRoots, unscannedRoots } from "../src/testing";
import { PACKAGE_DIR, REPO_ROOT, SRC_DIR } from "./helpers/paths";

const APP_DICTIONARY = /(?:^|\/)(?:lib\/strings|strings-en)(?:\.tsx?)?$/;
const APP_PACKAGE = /^@prismshadow\/penguin-web(?:\/|$)/;

/** Every refused shape in one source text, as "line: what". `path` places relative specifiers. */
function appStringReaches(path: string, text: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const checkSpecifier = (node: ts.Node, specifier: string) => {
    if (APP_PACKAGE.test(specifier)) found.push(`${at(node)}: imports ${specifier}`);
    else if (APP_DICTIONARY.test(specifier)) found.push(`${at(node)}: imports ${specifier}`);
    else if (specifier.startsWith(".")) {
      const target = resolve(dirname(path), specifier);
      if (!`${target}${sep}`.startsWith(PACKAGE_DIR)) {
        found.push(`${at(node)}: imports ${specifier}, outside packages/ui`);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node, node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      checkSpecifier(node, node.arguments[0].text);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "S"
    ) {
      found.push(`${at(node)}: reads S.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the package's copy", () => {
  const scan = scanSourceRoots(
    { ui: SRC_DIR },
    { repoRoot: REPO_ROOT, extensions: [".ts", ".tsx"] },
  );

  it("scans the package source", () => {
    expect(unscannedRoots(scan)).toEqual([]);
  });

  it("never comes from the web app's dictionaries", () => {
    const reaches = scan.files.flatMap((file) =>
      appStringReaches(file.path, file.text).map((hit) => `${file.id}:${hit}`),
    );
    expect(
      reaches,
      "Copy arrives as props; accessibility fallbacks come from the package's own UiStrings.",
    ).toEqual([]);
  });

  it("recognizes each refused shape — the check is exercised on known sources", () => {
    const probe = resolve(SRC_DIR, "components", "actions", "button", "button.tsx");
    const hits = (text: string) => appStringReaches(probe, text);
    // One report per import, however many of the shapes it matches.
    expect(hits('import { S } from "../../../../../web/src/lib/strings";')).toEqual([
      "1: imports ../../../../../web/src/lib/strings",
    ]);
    expect(hits('import { zh } from "../../../../../web/src/i18n";')).toEqual([
      "1: imports ../../../../../web/src/i18n, outside packages/ui",
    ]);
    expect(hits('export { en } from "@prismshadow/penguin-web/strings-en";')).toEqual([
      "1: imports @prismshadow/penguin-web/strings-en",
    ]);
    expect(hits('const m = await import("../lib/strings");')).toEqual([
      "1: imports ../lib/strings",
    ]);
    expect(hits("const label = S.common.close;")).toEqual(["1: reads S.common"]);
    // The package's own strings, sibling modules and npm packages are all fine.
    expect(
      hits(
        [
          'import { useUiStrings } from "../../../strings";',
          'import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";',
          'import { renderToStaticMarkup } from "react-dom/server";',
          "const s = useUiStrings(); const label = s.close;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
