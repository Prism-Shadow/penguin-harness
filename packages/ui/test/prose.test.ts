/**
 * Prose and Md: Markdown in its reading box, the three densities, the link default and the
 * resolver that overrides it, and fenced code routed into CodeBlock. How the pipeline typesets
 * math is prose-math.test.ts; where a bare URL ends and when bold closes beside it is
 * prose-bare-url.test.ts; the stylesheets the box reads are held with every component stylesheet
 * by component-stylesheets.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Md,
  PROSE_NEW_TAB,
  Prose,
  ProseLinksProvider,
} from "../src/components/content/prose/prose";
import type { ProseLinkResolver } from "../src/components/content/prose/prose";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

/** All rendered <a ...> opening tags. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

describe("Prose", () => {
  it("renders the caller's Markdown", () => {
    const html = renderStatic(
      createElement(Prose, { text: "Hello **world**", className: "text-base text-fg" }),
    );
    expect(html).toMatch(/^<div class="md-body font-sans text-base text-fg">/);
    expect(html).toContain("<strong>world</strong>");
  });

  it("takes the three densities as class sets prose.css styles", () => {
    const tokens = (variant: "body" | "compact" | "flush") =>
      classTokens(renderStatic(createElement(Prose, { text: "x", variant })));
    expect(tokens("body")).toContain("md-body");
    expect(tokens("compact")).toEqual(expect.arrayContaining(["md-body", "md-compact"]));
    expect(tokens("flush")).toEqual(expect.arrayContaining(["md-body", "md-body-flush"]));
  });
});

describe("Md links", () => {
  it("open in a new tab when no resolver is provided", () => {
    const tags = anchors(
      renderStatic(createElement(Md, { text: "[a](https://example.com) and [b](notes.md)" })),
    );
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toContain('target="_blank"');
      expect(tag).toContain('rel="noreferrer"');
    }
  });

  it("take what a resolver decides, per href, after the href itself", () => {
    const seen: (string | undefined)[] = [];
    const resolve: ProseLinkResolver = (href) => {
      seen.push(href);
      return href?.startsWith("https:") ? PROSE_NEW_TAB : {};
    };
    const html = renderStatic(
      createElement(ProseLinksProvider, {
        resolve,
        children: createElement(Md, { text: "[a](https://example.com) and [b](notes.md)" }),
      }),
    );
    const [external, local] = anchors(html);
    expect(external).toContain('target="_blank"');
    expect(local).toContain('href="notes.md"');
    expect(local).not.toContain("target=");
    expect(seen).toEqual(["https://example.com", "notes.md"]);
  });

  it("carry a link title as the shared tooltip, not a native title", () => {
    const [tag] = anchors(renderStatic(createElement(Md, { text: '[a](https://x.dev "Docs")' })));
    expect(tag).toContain('data-tooltip="Docs"');
    expect(tag).not.toContain("title=");
  });
});

describe("Md code", () => {
  it("routes a fenced block into CodeBlock, named in the interface's words", () => {
    const zh = { ...DEFAULT_UI_STRINGS, copyCode: "复制代码" };
    const html = renderStatic(
      createElement(UiStringsProvider, {
        strings: zh,
        children: createElement(Md, { text: "```ts\nconst a = 1;\n```" }),
      }),
    );
    expect(html).toContain("code-block");
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain("const a = 1;");
  });

  it("keeps inline code a bare <code> for the stylesheet to dress", () => {
    const html = renderStatic(createElement(Md, { text: "run `pnpm test` now" }));
    expect(html).toContain("<code>pnpm test</code>");
  });

  it("lets a surface add adapters over the settled map without losing the code block", () => {
    const html = renderStatic(
      createElement(Md, {
        text: "![alt](pic.png)\n\n```\nx\n```",
        components: { img: () => createElement("i", null, "image") },
      }),
    );
    expect(html).toContain("<i>image</i>");
    expect(html).toContain("code-block");
  });
});
