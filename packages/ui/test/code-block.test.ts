/**
 * CodeBlock and CodeSurface: the framed block's anatomy and tokens, the surface's plain rendering
 * and gutter, who highlights (the prop, the provider, or nobody), the language tables, and the
 * boundary that keeps the Shiki engine off every static import of the package.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  CodeBlock,
  CodeHighlighterProvider,
  CodeSurface,
  resolveHighlighter,
  useCodeHighlighter,
} from "../src/components/content/code-block/code-block";
import type { CodeHighlighter } from "../src/components/content/code-block/code-block";
import {
  LANGUAGE_ALIASES,
  LANGUAGE_LOADERS,
  PLAIN_TEXT_LANGUAGE,
  languageForExtension,
  resolveLanguage,
} from "../src/components/content/code-block/code-languages";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";
import { PACKAGE_DIR, SRC_DIR } from "./helpers/paths";

const highlighter: CodeHighlighter = async () => "<pre></pre>";

describe("CodeBlock", () => {
  const html = renderStatic(createElement(CodeBlock, { language: "ts", code: "const a = 1;" }));

  it("is a ruled frame with a head and a body, for a theme's ui-frame recipe", () => {
    expect(html).toMatch(/^<div class="code-block ui-frame /);
    expect(html).toContain('<div data-slot="head"');
    expect(html).toContain('<div data-slot="body"');
  });

  it("paints its box, head and body from the code tokens and sets the code rung", () => {
    expect(classTokens(html)).toEqual(
      expect.arrayContaining([
        "border-[var(--ui-code-line)]",
        "bg-[var(--ui-code-bg)]",
        "bg-canvas",
        "text-[length:var(--ui-text-code-size)]",
        "text-fg-muted",
      ]),
    );
    expect(classTokens(html).filter((token) => /gray|dark:|white/.test(token))).toEqual([]);
  });

  it("labels the language as given, plain text when the fence named none", () => {
    expect(html).toMatch(/>ts<\/span>/);
    const bare = renderStatic(createElement(CodeBlock, { language: "", code: "x" }));
    expect(bare).toMatch(/>text<\/span>/);
  });

  it("names its copy button in the interface's words, or the caller's", () => {
    expect(html).toContain(`aria-label="${DEFAULT_UI_STRINGS.copyCode}"`);
    const zh = renderStatic(
      createElement(UiStringsProvider, {
        strings: { ...DEFAULT_UI_STRINGS, copyCode: "复制代码" },
        children: createElement(CodeBlock, { language: "ts", code: "x" }),
      }),
    );
    expect(zh).toContain('aria-label="复制代码"');
    const own = renderStatic(
      createElement(CodeBlock, { language: "ts", code: "x", copyLabel: "Copy snippet" }),
    );
    expect(own).toContain('aria-label="Copy snippet"');
  });
});

describe("CodeSurface", () => {
  it("renders the code plain until a highlighter answers", () => {
    const html = renderStatic(createElement(CodeSurface, { language: "ts", code: "a < b" }));
    expect(html).toMatch(/^<div class="code-surface code-nowrap /);
    expect(html).toContain("<pre><code>a &lt; b</code></pre>");
  });

  it("splits the lines into blocks and sizes the gutter by the digit count", () => {
    const code = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const html = renderStatic(
      createElement(CodeSurface, { language: "text", code, lineNumbers: true, wrap: true }),
    );
    expect(html).toContain("code-wrap");
    expect(html).toContain("code-lines");
    expect(html).toContain("--code-gutter:4ch");
    expect(html.match(/<span class="line">/g)).toHaveLength(12);
  });
});

describe("who highlights", () => {
  it("is the prop's function, else the provider's, else nobody", () => {
    const other: CodeHighlighter = async () => undefined;
    expect(resolveHighlighter(other, highlighter)).toBe(other);
    expect(resolveHighlighter(true, highlighter)).toBe(highlighter);
    expect(resolveHighlighter(true, null)).toBeNull();
    expect(resolveHighlighter(false, highlighter)).toBeNull();
  });

  it("is read from the nearest provider", () => {
    let seen: CodeHighlighter | null | undefined;
    function Probe() {
      seen = useCodeHighlighter();
      return null;
    }
    renderStatic(createElement(Probe));
    expect(seen).toBeNull();
    renderStatic(
      createElement(CodeHighlighterProvider, {
        highlight: highlighter,
        children: createElement(Probe),
      }),
    );
    expect(seen).toBe(highlighter);
  });
});

describe("the language tables", () => {
  it("route fence names and extensions to a grammar, and unknown ones to plain text or nothing", () => {
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage(" Bash ")).toBe("shellscript");
    expect(resolveLanguage("")).toBe(PLAIN_TEXT_LANGUAGE);
    expect(resolveLanguage("cobol")).toBeUndefined();
    expect(languageForExtension("TSX")).toBe("tsx");
    expect(languageForExtension("unknown")).toBe(PLAIN_TEXT_LANGUAGE);
  });

  it("never resolve a prototype key", () => {
    expect(resolveLanguage("constructor")).toBeUndefined();
    expect(languageForExtension("__proto__")).toBe(PLAIN_TEXT_LANGUAGE);
  });

  it("alias only languages there is a grammar for", () => {
    for (const [alias, id] of LANGUAGE_ALIASES) expect(LANGUAGE_LOADERS.has(id), alias).toBe(true);
  });
});

describe("the engine boundary", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });

  it("is imported by no module of the package, and not from the barrel", () => {
    const importers = files(SRC_DIR)
      .filter((path) => /from "[^"]*highlighter-core"/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC_DIR, path).split("\\").join("/"));
    expect(importers).toEqual([]);
  });

  it("is published on its own subpath, for a worker to import without React", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports["./highlighter"]).toBe(
      "./src/components/content/code-block/highlighter-core.ts",
    );
    const engine = readFileSync(
      join(SRC_DIR, "components/content/code-block/highlighter-core.ts"),
      "utf8",
    );
    expect(engine).not.toMatch(/from "react"/);
  });
});
