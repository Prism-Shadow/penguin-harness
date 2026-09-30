/**
 * CloseButton: a real button named by the interface's word for "close" unless the caller names
 * it, with the caller's tooltip, drawn in tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CloseButton } from "../src/components/actions/close-button/close-button";
import { UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => {};

describe("CloseButton", () => {
  it("is a button named by the package's fallback when nothing else names it", () => {
    const html = renderStatic(createElement(CloseButton, { onClose: noop }));
    expect(html).toMatch(/^<button type="button" aria-label="Close"/);
    expect(html).not.toContain("title=");
  });

  it("takes the injected word, and a caller's label over both", () => {
    const strings = { close: "关闭", copied: "已复制", loading: "加载中…" };
    const injected = renderStatic(
      createElement(UiStringsProvider, { strings }, createElement(CloseButton, { onClose: noop })),
    );
    expect(injected).toContain('aria-label="关闭"');
    const named = renderStatic(
      createElement(
        UiStringsProvider,
        { strings },
        createElement(CloseButton, { onClose: noop, label: "Dismiss the notice" }),
      ),
    );
    expect(named).toContain('aria-label="Dismiss the notice"');
  });

  it("shows the caller's tooltip through the app's tooltip layer, never a native title", () => {
    const html = renderStatic(createElement(CloseButton, { onClose: noop, title: "Close (Esc)" }));
    expect(html).toContain('data-tooltip="Close (Esc)"');
    expect(html).not.toContain("title=");
  });

  it("paints in tokens, on the control radius", () => {
    const tokens = classTokens(renderStatic(createElement(CloseButton, { onClose: noop })));
    expect(tokens).toEqual(
      expect.arrayContaining([
        "rounded-control",
        "text-fg-subtle",
        "hover:bg-surface-muted",
        "hover:text-fg-muted",
      ]),
    );
  });
});
