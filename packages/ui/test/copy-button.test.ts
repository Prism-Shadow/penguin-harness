/**
 * CopyButton and its parts: a wordless button named and tooltipped by the action, whose only
 * visible feedback is the glyph swap, and a live region beside it — not inside it — that
 * announces the copy in the interface's words.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  CopiedStatus,
  CopyButton,
  CopyCheckGlyph,
} from "../src/components/actions/copy-button/copy-button";
import { ICONS } from "../src/components/icons/icons";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const ZH = { ...DEFAULT_UI_STRINGS, close: "关闭", copied: "已复制", loading: "加载中…" };

describe("CopyButton", () => {
  it("names the action, shows no text, and keeps the live region as a sibling", () => {
    const html = renderStatic(createElement(CopyButton, { text: "s-1", label: "Copy session id" }));
    expect(html).toMatch(
      /^<button type="button" data-tooltip="Copy session id" aria-label="Copy session id"/,
    );
    const button = html.slice(0, html.indexOf("</button>"));
    expect(button).not.toContain("aria-live");
    expect(button.replace(/<[^>]*>/g, "")).toBe("");
    expect(html.slice(html.indexOf("</button>"))).toMatch(
      /^<\/button><span class="sr-only" aria-live="polite" aria-atomic="true"><\/span>$/,
    );
    expect(html).toContain(`d="${ICONS.copy}"`);
  });

  it("paints in tokens, at the row size or the padded size, plus the caller's layout", () => {
    const md = classTokens(renderStatic(createElement(CopyButton, { text: "x", label: "Copy" })));
    expect(md).toEqual(
      expect.arrayContaining([
        "p-1",
        "text-fg-subtle",
        "hover:bg-surface-muted",
        "hover:text-fg-muted",
      ]),
    );
    const sm = classTokens(
      renderStatic(
        createElement(CopyButton, { text: "x", label: "Copy", size: "sm", className: "shrink-0" }),
      ),
    );
    expect(sm).toEqual(expect.arrayContaining(["size-5", "shrink-0", "text-fg-subtle"]));
    expect(sm).not.toContain("p-1");
  });
});

describe("the copy feedback", () => {
  it("swaps only the glyph", () => {
    expect(renderStatic(createElement(CopyCheckGlyph, { copied: false }))).toContain(
      `d="${ICONS.copy}"`,
    );
    expect(renderStatic(createElement(CopyCheckGlyph, { copied: true }))).toContain(
      `d="${ICONS.check}"`,
    );
  });

  it("announces in the interface's words, or the caller's, once copied", () => {
    expect(renderStatic(createElement(CopiedStatus, { copied: false }))).not.toContain("Copied");
    expect(renderStatic(createElement(CopiedStatus, { copied: true }))).toContain(">Copied<");
    const injected = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: ZH },
        createElement(CopiedStatus, { copied: true }),
      ),
    );
    expect(injected).toContain(">已复制<");
    expect(
      renderStatic(createElement(CopiedStatus, { copied: true, announcement: "Path copied" })),
    ).toContain(">Path copied<");
  });
});
