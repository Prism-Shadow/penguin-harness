/**
 * Guard: the field-marker contract (the UI package's forms/field/field.tsx) — **a required field
 * carries the red "*", an optional field carries nothing at all, and no label or placeholder
 * writes the word "optional".** How RequiredMark and a required Input render is the UI package's
 * to test (packages/ui/test/field.test.ts, input.test.ts); this file holds the rule across the
 * app.
 *
 * - The field module lives in one place, and no other file hand-rolls a red "*" (found however
 *   its className is written).
 * - Neither dictionary says "optional" in a label, and every prose exception still says it (so
 *   the allow-list cannot rot).
 *
 * The source scan parses the real JSX with the TypeScript parser: whether a red span holds a lone
 * "*" is a question about an element's children, and a regex cannot see children.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { expectEveryRootScanned, expectSingleHome, scanSources } from "./helpers/roots";

/** Web and the shared UI package: a hand-rolled mark is a second spelling on either side. */
const SCAN = scanSources();
/** The one place the mark is allowed to be spelled. */
const FIELD = "packages/ui/src/components/forms/field/field.tsx";

/**
 * Every string literal reachable from a node, joined. `className` is written four ways here —
 * `"a b"`, `{"a b"}`, `` {`a ${x}`} `` and `{c ? "a" : "b"}` — and a scan that reads only the
 * first would miss the copy most likely to be re-typed.
 */
function literals(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) out.push(span.literal.text);
  }
  ts.forEachChild(node, (child) => void literals(child, out));
  return out;
}

/** The element's `className`, in whichever of those forms it was written. */
function classNameOf(open: ts.JsxOpeningElement): string {
  for (const attr of open.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (!ts.isIdentifier(attr.name) || attr.name.escapedText !== "className") continue;
    const init = attr.initializer;
    if (init !== undefined) return literals(init).join(" ");
  }
  return "";
}

/** The element's own text, whether written as JSX text or as a `{"*"}` expression child. */
function childText(node: ts.JsxElement): string {
  return node.children
    .map((c) => {
      if (ts.isJsxText(c)) return c.text;
      if (ts.isJsxExpression(c) && c.expression !== undefined)
        return literals(c.expression).join("");
      return "";
    })
    .join("")
    .trim();
}

/** A red ink, as a palette class (the web app) or the danger tone's token (the package). */
const RED_INK = /\btext-(?:red-|tone-danger-)/;

/**
 * Every element that paints a lone "*" in a red ink class — i.e. a hand-rolled required mark — as
 * "id:line".
 */
function marksIn(id: string, text: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(id, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const visit = (node: ts.Node): void => {
    // The children test is cheap and rejects all but a handful of the tree's ~2200 elements,
    // so it runs before the attribute walk.
    if (ts.isJsxElement(node) && childText(node) === "*") {
      if (RED_INK.test(classNameOf(node.openingElement))) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${id}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function handRolledMarks(): string[] {
  const found: string[] = [];
  for (const file of SCAN.files) {
    if (!file.name.endsWith(".tsx") || file.id === FIELD) continue;
    found.push(...marksIn(file.id, file.text));
  }
  return found.sort();
}

/**
 * Both dictionaries are searched with both patterns: the zh entries mix English freely
 * ("Workspace（可选…）" was one of them), so a locale-specific pattern would only be enforcing
 * the rule on half of each file. The Chinese alternatives are listed because 可选 is one of
 * several ways to write it — 可留空 / 选填 / 非必填 all say the same thing to a reader.
 * Functions are skipped: an interpolating entry is prose by construction, never a field label.
 */
const SAYS_OPTIONAL = /\boptional(ly)?\b|(?<!不)可选(?!择)|可留空|选填|非必填|可不填/i;

function optionalWording(dict: unknown, path = ""): string[] {
  if (typeof dict === "string") return SAYS_OPTIONAL.test(dict) ? [path] : [];
  if (dict === null || typeof dict !== "object") return [];
  return Object.entries(dict as Record<string, unknown>).flatMap(([key, value]) =>
    optionalWording(value, path === "" ? key : `${path}.${key}`),
  );
}

/**
 * Entries where the word is part of an explanation rather than a field marker, and so stays,
 * listed per locale — an exception earned by one dictionary's wording says nothing about the
 * other's. A new entry needs a reason of the same kind: "this sentence describes something that
 * is itself optional", not "this label is optional".
 */
const PROSE_EXCEPTIONS: Record<"zh" | "en", ReadonlySet<string>> = {
  // Describes the tool schema's own `description` argument, which really is an optional argument.
  zh: new Set(["agent.callDescriptionHint"]),
  en: new Set([
    "agent.callDescriptionHint",
    // States the accepted number format: the k/m suffix may be left off.
    "chat.goalBudgetInvalid",
  ]),
};

describe("required mark", () => {
  it("scans every source root, and finds the field module in one place", () => {
    expectEveryRootScanned(SCAN);
    expectSingleHome(SCAN, FIELD);
  });

  it("is spelled in exactly one place", () => {
    expect(
      handRolledMarks(),
      "A red '*' belongs to RequiredMark (the UI package's forms/field). Pass `required` to " +
        "Field/Input/Textarea/Select/OptionMenu, use <FieldLabel required> for a custom label " +
        "row, or render <RequiredMark /> directly.",
    ).toEqual([]);
  });

  it("finds a hand-rolled mark however its className is written", () => {
    // Without this the scan above could silently stop matching and still report a clean tree.
    const probe = "packages/web/src/probe.tsx";
    const shapes = [
      'const a = <span className="ml-0.5 text-red-500">*</span>;',
      "const b = <span className={`ml-0.5 text-red-500`}>*</span>;",
      'const c = <span className={dim ? "text-red-500" : ""}>*</span>;',
      'const d = <span className="text-red-500">{"*"}</span>;',
      'const e = <span className="ml-0.5 text-tone-danger-fg">*</span>;',
    ];
    expect(marksIn(probe, shapes.join("\n"))).toHaveLength(shapes.length);
    expect(marksIn(probe, '<span className="text-gray-500">*</span>')).toEqual([]);
  });

  for (const [locale, dict] of [
    ["zh", zh],
    ["en", en],
  ] as const) {
    it(`never says "optional" in a ${locale} label`, () => {
      const said = optionalWording(dict).filter((p) => !PROSE_EXCEPTIONS[locale].has(p));
      expect(
        said,
        'A field is optional because it has no red "*", never because its label says so.',
      ).toEqual([]);
    });

    it(`keeps the ${locale} prose exceptions real (guards the allow-list against rot)`, () => {
      // A stale exception would quietly re-open the hole it was cut for. Per locale, because a
      // union lets one dictionary's wording keep the other's dead entry alive.
      const said = new Set(optionalWording(dict));
      for (const path of PROSE_EXCEPTIONS[locale]) {
        expect(said, `${locale}: ${path} no longer says it`).toContain(path);
      }
    });
  }
});
