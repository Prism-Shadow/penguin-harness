/**
 * PasswordInput (src/components/forms/password-input/password-input.tsx): a masked Input with a
 * reveal toggle named in the interface's words, and its error text wired from outside the box.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { PasswordInput } from "../src/components/forms/password-input/password-input";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { renderStatic } from "../src/testing";

const field = (props: Parameters<typeof PasswordInput>[0] = {}) =>
  renderStatic(createElement(PasswordInput, { value: "", readOnly: true, ...props }));

describe("PasswordInput", () => {
  it("starts masked, and keeps the saved login out of an opted-out box", () => {
    const html = field();
    expect(html).toContain('type="password"');
    expect(html).toMatch(/autocomplete="new-password"/i);
  });

  it("names its reveal toggle in the package's words, and keeps it out of the tab order", () => {
    const html = field();
    expect(html).toMatch(
      /<button type="button" aria-label="Show password" data-tooltip="Show password" tabindex="-1"/,
    );
    expect(html).toContain(`d="${ICONS.eye}"`);
    expect(html).not.toContain("aria-pressed");
  });

  it("speaks the injected words, and a caller's labels over both", () => {
    const strings = { ...DEFAULT_UI_STRINGS, showPassword: "显示密码", hidePassword: "隐藏密码" };
    const injected = renderStatic(
      createElement(
        UiStringsProvider,
        { strings },
        createElement(PasswordInput, { value: "", readOnly: true }),
      ),
    );
    expect(injected).toContain('aria-label="显示密码"');
    const named = field({ toggleLabels: { show: "Show the key", hide: "Hide the key" } });
    expect(named).toContain('aria-label="Show the key"');
  });

  it("renders the error under the box and points the masked input at it", () => {
    const html = field({ label: "Password", error: "Too short" });
    const errorId = /<span id="([^"]+)" role="alert"/.exec(html)?.[1];
    expect(errorId).toBeDefined();
    expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="${errorId}"`));
    expect(html).toContain('aria-invalid="true"');
    // One error text: the inner Input only gets the invalid mark.
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });
});
