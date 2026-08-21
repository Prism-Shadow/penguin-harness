/**
 * The field-marker contract (src/components/ui/field.tsx): **a required field carries the red
 * "*", an optional field carries nothing at all, and no label or placeholder writes the word
 * "optional".**
 *
 * The absence of the mark is the whole signal, so it only reads if the mark is spelled one way
 * everywhere and never competes with a second, wordier convention. Three copies of the asterisk
 * and four labels ending in "(optional)" had already accumulated, which is what makes this a
 * checked rule rather than a remembered one — the same reason test/icon-scale.test.ts fails on a
 * second copy of the close cross.
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

/** The element's `className`, when it is a plain string literal (the only form worth reading here). */
function classNameOf(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string | null {
  for (const attr of open.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "className") continue;
    const init = attr.initializer;
    if (init !== undefined && ts.isStringLiteral(init)) return init.text;
  }
  return null;
}

/** Every element that paints a lone "*" in a red ink class — i.e. a hand-rolled required mark. */
function handRolledMarks(): string[] {
  const found: string[] = [];
  for (const path of tsxFiles()) {
    if (path === FIELD) continue; // the one place the mark is allowed to be spelled
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node)) {
        const className = classNameOf(node.openingElement) ?? "";
        const text = node.children
          .map((c) => (ts.isJsxText(c) ? c.text : ""))
          .join("")
          .trim();
        if (className.includes("text-red-") && text === "*") {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          found.push(`${path.slice(SRC.length + 1).replaceAll(sep, "/")}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found.sort();
}

/**
 * Strings in a dictionary that say "optional" out loud, as `path -> value`. Functions are
 * skipped: an interpolating entry is prose by construction, never a field label.
 */
function optionalWording(dict: unknown, locale: "zh" | "en", path = ""): string[] {
  if (typeof dict === "string") {
    const said = locale === "zh" ? /可选/.test(dict) : /\boptional\b/i.test(dict);
    return said ? [path] : [];
  }
  if (dict === null || typeof dict !== "object") return [];
  return Object.entries(dict as Record<string, unknown>).flatMap(([key, value]) =>
    optionalWording(value, locale, path === "" ? key : `${path}.${key}`),
  );
}

/**
 * Entries where the word is part of an explanation rather than a field marker, and so stays.
 * A new entry here needs a reason of the same kind — "this sentence describes something that is
 * itself optional", not "this label is optional".
 */
const PROSE_EXCEPTIONS = new Set([
  // Describes the tool schema's own `description` argument, which really is an optional argument.
  "agent.callDescriptionHint",
  // A bridge to the chat, not a form: the sentence says the user may finish the thought there.
  "memory.editRequirementPlaceholder",
  // States the accepted number format: the k/m suffix may be left off.
  "chat.goalBudgetInvalid",
]);

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

  it("leaves an optional field completely unmarked", () => {
    // No counterpart mark and no wording: absence is the signal, so anything here would blunt it.
    const optional = renderToStaticMarkup(
      createElement(Input, { label: "Name", value: "", readOnly: true }),
    );
    expect(optional).not.toContain("*");
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

  for (const [locale, dict] of [
    ["zh", zh],
    ["en", en],
  ] as const) {
    it(`never says "optional" in a ${locale} label`, () => {
      const said = optionalWording(dict, locale).filter((p) => !PROSE_EXCEPTIONS.has(p));
      expect(
        said,
        'A field is optional because it has no red "*", never because its label says so.',
      ).toEqual([]);
    });
  }

  it("keeps the prose exceptions real (guards the allow-list against rot)", () => {
    // A stale exception would quietly re-open the hole it was cut for.
    const said = new Set([...optionalWording(zh, "zh"), ...optionalWording(en, "en")]);
    for (const path of PROSE_EXCEPTIONS) expect(said, `${path} no longer says it`).toContain(path);
  });
});
