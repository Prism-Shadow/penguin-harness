/**
 * The form-control size scale (src/components/ui/input.tsx's `sizeTextClass`).
 *
 * A control's font size comes from its `size` prop and nowhere else. A `text-*` in a caller's
 * `className` does not reliably override the component's own — both are single-class font-size
 * utilities of equal specificity, so which one wins is decided by the order Tailwind generated
 * the stylesheet in, not by the order of classes in the string. The built sheet emits `.text-base`
 * before `.text-sm` before `.text-xs`, which means a caller asking for `text-sm` on an `sm` control
 * silently loses, while a `text-[13px]` wins and freezes the control against the font-size tier the
 * user chose in settings.
 *
 * That is invisible in review — the class is right there in the diff, and it simply does nothing —
 * so it is checked rather than remembered. The check parses the real JSX with the TypeScript
 * parser: whether a class sits on a control or on the `<div>` wrapping it is a question about which
 * element owns the attribute, and a regex over the file cannot tell those apart.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** The controls that carry a `size` tier. A `className` on one of these may not set a font size. */
const CONTROLS = new Set([
  "Input",
  "Textarea",
  "Select",
  "OptionMenu",
  "PasswordInput",
  "FormPicker",
]);

/**
 * Font-size utilities only. `text-gray-500`, `text-left` and `text-red-600` are colour and
 * alignment and stay a caller's business; the bracket form is included because it is the one that
 * silently opts a control out of the user's font-size setting.
 */
const FONT_SIZE_CLASS = /\btext-(?:xs|sm|base|lg|xl|\d?xl|\[[^\]]+])(?![\w-])/;

function tsxFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const jsxTag = (node: ts.Node): string | null => {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxOpeningElement(node)) return node.tagName.getText();
  return null;
};

/**
 * Every literal chunk of a `className` value. A template literal's interpolations are skipped on
 * purpose: `${sizeTextClass[size]}` is exactly the sanctioned way to reach a rung, so only the text
 * typed around it is the caller's own spelling.
 */
function literalChunks(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) out.push(span.literal.text);
  } else {
    // The callback must return nothing: forEachChild stops at the first truthy result, so
    // returning the accumulator here would visit one child and quietly skip the rest.
    ts.forEachChild(node, (child) => {
      literalChunks(child, out);
    });
  }
  return out;
}

/**
 * `<Button>`s inside a `Modal`'s `footer={…}` that do not ask for the `sm` rung. `Modal` renders
 * only the footer's wrapper — the buttons come from each caller as an opaque node — so there is no
 * single place to set this and the rule has to be checked instead.
 *
 * The reach is what a parser can see without types: Buttons written inline in the `footer={…}`
 * attribute. A footer handed over as a component (`footer={<Footer …/>}`) or built in a variable
 * is on the same rule but out of this check's sight. A Button in a dialog *body* is covered by
 * `findLooseDialogBodyButtons` instead, for the modules that are only ever dialog content.
 */
function findLooseFooterButtons(): string[] {
  const loose: string[] = [];
  for (const path of tsxFiles()) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText() === "footer" && node.initializer) {
        const walk = (inner: ts.Node): void => {
          if (jsxTag(inner) === "Button") {
            const attrs = (inner as ts.JsxSelfClosingElement | ts.JsxOpeningElement).attributes
              .properties;
            const size = attrs.find(
              (attr) => ts.isJsxAttribute(attr) && attr.name.getText() === "size",
            );
            // The rung has to be `sm`, not merely stated: `size="md"` in a footer is the
            // very drift this check exists for, and a missing prop takes Button's md default.
            const rung =
              size !== undefined && ts.isJsxAttribute(size) && size.initializer !== undefined
                ? size.initializer.getText()
                : "<none>";
            if (rung !== '"sm"') {
              const line = source.getLineAndCharacterOfPosition(inner.getStart(source)).line + 1;
              loose.push(`${path.slice(SRC.length + 1).replaceAll(sep, "/")}:${line} ${rung}`);
            }
          }
          ts.forEachChild(inner, walk);
        };
        walk(node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return loose.sort();
}

/**
 * Modules that are only ever rendered as a dialog's body. The settings dialog is a `PagedDialog`,
 * which is a `Modal`, and each of these is one of its pages — so every Button in them belongs with
 * the fields beside it on the `sm` rung, exactly as a footer button does. A parser cannot infer
 * that from the file alone (nothing in a section module says it renders in a dialog), so the fact
 * is declared here. Add a module when it becomes settings-dialog content; drop one when it stops.
 */
const DIALOG_BODY_MODULES = new Set([
  "features/settings/account-section.tsx",
  "features/settings/profile-section.tsx",
  "features/settings/appearance-section.tsx",
  "features/settings/general-section.tsx",
  "features/settings/proxy-section.tsx",
  "features/settings/section-shell.tsx",
  "features/settings/setting-row.tsx",
  "features/settings/trace-import-row.tsx",
  "features/settings/uploads-section.tsx",
  "features/admin/admin-users-page.tsx",
]);

/**
 * Buttons in a dialog-body module that do not ask for `sm`, as "relative/path:line rung". `icon`
 * passes: a square glyph button carries no text and so sits on no font rung.
 */
function findLooseDialogBodyButtons(): string[] {
  const loose: string[] = [];
  for (const path of tsxFiles()) {
    const rel = path.slice(SRC.length + 1).replaceAll(sep, "/");
    if (!DIALOG_BODY_MODULES.has(rel)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (jsxTag(node) === "Button") {
        const attrs = (node as ts.JsxSelfClosingElement | ts.JsxOpeningElement).attributes
          .properties;
        const size = attrs.find(
          (attr) => ts.isJsxAttribute(attr) && attr.name.getText() === "size",
        );
        const rung =
          size !== undefined && ts.isJsxAttribute(size) && size.initializer !== undefined
            ? size.initializer.getText()
            : "<none>";
        if (rung !== '"sm"' && rung !== '"icon"') {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          loose.push(`${rel}:${line} ${rung}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return loose.sort();
}

/** Control call sites whose own `className` spells a font size, as "relative/path:line — class". */
function findSpelledSizes(): string[] {
  const strays: string[] = [];
  for (const path of tsxFiles()) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      const tag = jsxTag(node);
      if (tag !== null && CONTROLS.has(tag)) {
        const attrs = (node as ts.JsxSelfClosingElement | ts.JsxOpeningElement).attributes
          .properties;
        for (const attr of attrs) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "className") continue;
          if (attr.initializer === undefined) continue;
          for (const chunk of literalChunks(attr.initializer)) {
            const hit = FONT_SIZE_CLASS.exec(chunk);
            if (hit === null) continue;
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            strays.push(
              `${path.slice(SRC.length + 1).replaceAll(sep, "/")}:${line} <${tag}> ${hit[0]}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return strays.sort();
}

describe("control font size", () => {
  it("is never spelled on a call site's className", () => {
    expect(
      findSpelledSizes(),
      "A control's font size comes from its `size` prop (sm for a form field, base for a " +
        "standalone page like login). A text-* class beside it either does nothing or freezes " +
        "the control against the user's font-size setting — see components/ui/input.tsx.",
    ).toEqual([]);
  });

  it("actually reads the control's own attribute — the check is exercised on known shapes", () => {
    // Guards the guard: without this, the assertion above would pass just as happily on a
    // `literalChunks` that had stopped seeing template text.
    const found = (jsx: string): string[] => {
      const source = ts.createSourceFile(
        "t.tsx",
        `const x = ${jsx};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const hits: string[] = [];
      const visit = (node: ts.Node): void => {
        const tag = jsxTag(node);
        if (tag !== null && CONTROLS.has(tag)) {
          for (const attr of (node as ts.JsxSelfClosingElement).attributes.properties) {
            if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "className") continue;
            if (attr.initializer === undefined) continue;
            for (const chunk of literalChunks(attr.initializer)) {
              const hit = FONT_SIZE_CLASS.exec(chunk);
              if (hit !== null) hits.push(hit[0]);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return hits;
    };
    // A plain string, and inside a template around an interpolation.
    expect(found('<Input className="w-full text-sm" />')).toEqual(["text-sm"]);
    expect(found("<Textarea className={`w-full ${x} text-[13px]`} />")).toEqual(["text-[13px]"]);
    // Colour, alignment and a same-prefixed utility are the caller's business, not a font size.
    expect(found('<Select className="text-left text-gray-500 text-red-600" />')).toEqual([]);
    // The sanctioned route: the rung arrives as an expression, never as typed text.
    expect(found("<OptionMenu className={sizeTextClass[size]} />")).toEqual([]);
    // The class is only a problem on the control itself.
    expect(found('<div className="text-sm"><Input /></div>')).toEqual([]);
  });

  it("puts a dialog's buttons on the same rung as its fields", () => {
    // A Modal footer's Buttons default to md (`text-sm px-3 py-1.5`) while the fields above them
    // are sm (`text-xs px-2 py-1`), which is how the two dialog families drifted apart —
    // ConfirmModal already passed sm by hand. `Modal` cannot impose it: it owns the footer's
    // wrapper, not the buttons in it.
    expect(
      findLooseFooterButtons(),
      'A Button in a Modal footer passes size="sm", so the dialog\'s buttons read at the same ' +
        "size as its fields (compare components/ui/confirm-modal.tsx).",
    ).toEqual([]);
  });

  it("keeps a dialog body's buttons on the fields' rung", () => {
    // Same rule as the footer, one layer in. The settings dialog's pages are separate modules, so
    // the drift hides from review twice over: nothing in a section file says it renders inside a
    // Modal, and the footer check above cannot see this far. Four of them had taken Button's md
    // default and stood a rung above the fields they sat beside.
    expect(
      findLooseDialogBodyButtons(),
      'A Button in a dialog body passes size="sm", the rung the fields beside it are on. ' +
        "If a module in DIALOG_BODY_MODULES has stopped being dialog content, drop it from the set.",
    ).toEqual([]);
  });

  it("spells a font size in the two records and nowhere else in the family", () => {
    // The point of the refactor, stated as the only thing a reader has to check: every font-size
    // class the control modules contain belongs to one of two records. `select.tsx` and
    // `form-picker.tsx` name none at all — before this scale they each kept a private copy of the
    // same two rungs, which is how they drifted.
    //
    // text-[Npx] is fixed px: it ignores the root font size theme.tsx sets per tier, so a control
    // carrying one stops responding to the user's font-size setting. `rowDescClass.sm` is the sole
    // exception — an OptionMenu row's description has to sit one step under a text-xs title, and
    // there is no rung below text-xs to step down to.
    // String literals only: a comment naming the shape it forbids must not trip its own guard.
    const spelled = (name: string): string[] => {
      const path = join(SRC, "components/ui", name);
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const found = new Set<string>();
      for (const chunk of literalChunks(source)) {
        for (const hit of chunk.matchAll(new RegExp(FONT_SIZE_CLASS, "g"))) found.add(hit[0]);
      }
      return [...found].sort();
    };
    expect(
      Object.fromEntries(
        ["input.tsx", "select.tsx", "option-menu.tsx", "form-picker.tsx"].map((name) => [
          name,
          spelled(name),
        ]),
      ),
      "A font size inside the control family lives in input.tsx's `sizeTextClass` or " +
        "option-menu.tsx's `rowDescClass`; a third copy is how the rungs drifted apart before.",
    ).toEqual({
      "input.tsx": ["text-base", "text-xs"], // sizeTextClass
      "option-menu.tsx": ["text-[11px]", "text-xs"], // rowDescClass
      "select.tsx": [],
      "form-picker.tsx": [],
    });
  });
});
