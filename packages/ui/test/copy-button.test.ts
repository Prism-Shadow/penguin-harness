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
import { renderStatic } from "../src/testing";

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
