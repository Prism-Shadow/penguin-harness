/**
 * The field-marker contract (src/components/ui/field.tsx): **a required field carries the red
 * "*", an optional field carries nothing at all, and no label or placeholder writes the word
 * "optional".**
 *
 * The absence of the mark is the whole signal, so it only reads if the mark is spelled one way
 * everywhere and never competes with a second, wordier convention — the same reason
 * test/icon-scale.test.ts fails on a second copy of the close cross.
 *
 * The source scan parses the real JSX with the TypeScript parser: whether a red span holds a lone
 * "*" is a question about an element's children, and a regex cannot see children.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Input } from "../src/components/ui/input";
import { RequiredMark } from "../src/components/ui/field";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const FIELD = join(SRC, "components", "ui", "field.tsx");

function tsxFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

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

/** Every element that paints a lone "*" in a red ink class — i.e. a hand-rolled required mark. */
function marksIn(path: string, text: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const visit = (node: ts.Node): void => {
    // The children test is cheap and rejects all but a handful of the tree's ~2200 elements,
    // so it runs before the attribute walk.
    if (ts.isJsxElement(node) && childText(node) === "*") {
      if (classNameOf(node.openingElement).includes("text-red-")) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${path.slice(SRC.length + 1).replaceAll(sep, "/")}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function handRolledMarks(): string[] {
  const found: string[] = [];
  for (const path of tsxFiles()) {
    if (path === FIELD) continue; // the one place the mark is allowed to be spelled
    found.push(...marksIn(path, readFileSync(path, "utf8")));
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
  it("renders only when the field is required", () => {
    const required = renderToStaticMarkup(
      createElement(Input, { label: "Name", required: true, value: "", readOnly: true }),
    );
    expect(required).toContain("*");
    expect(required).toContain("text-red-500");
    // Decorative to assistive tech — aria-required on the control is what gets announced.
    expect(required).toMatch(/<span[^>]*aria-hidden[^>]*>\*<\/span>/);
    expect(required).toContain('aria-required="true"');
  });

  it("states itself where no control carries aria-required", () => {
    // The trace viewer's schema table is not a form: nothing else there says "required".
    const spoken = renderToStaticMarkup(createElement(RequiredMark, { label: "required" }));
    expect(spoken).toMatch(/<span[^>]*aria-hidden[^>]*>\*<\/span>/);
    expect(spoken).toContain("required");
    expect(spoken).not.toMatch(/^<span[^>]*aria-hidden/);
  });

  it("leaves an optional field completely unmarked", () => {
    // No counterpart mark and no wording: absence is the signal, so anything here would blunt it.
    const optional = renderToStaticMarkup(
      createElement(Input, { label: "Name", value: "", readOnly: true }),
    );
    // Scoped to the mark's own shape: a bare `toContain("*")` over the markup would also trip
    // on a Tailwind `*:` variant landing in any class the control renders.
    expect(optional).not.toMatch(/<span[^>]*>\*<\/span>/);
    expect(optional).not.toContain("text-red-");
    expect(optional).not.toContain("aria-required");
  });

  it("is spelled in exactly one place", () => {
    expect(
      handRolledMarks(),
      "A red '*' belongs to RequiredMark (components/ui/field.tsx). Pass `required` to " +
        "Field/Input/Textarea/Select/OptionMenu, use <FieldLabel required> for a custom label " +
        "row, or render <RequiredMark /> directly.",
    ).toEqual([]);
  });

  it("finds a hand-rolled mark however its className is written", () => {
    // Without this the scan above could silently stop matching and still report a clean tree.
    const probe = join(SRC, "probe.tsx");
    const shapes = [
      'const a = <span className="ml-0.5 text-red-500">*</span>;',
      "const b = <span className={`ml-0.5 text-red-500`}>*</span>;",
      'const c = <span className={dim ? "text-red-500" : ""}>*</span>;',
      'const d = <span className="text-red-500">{"*"}</span>;',
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
