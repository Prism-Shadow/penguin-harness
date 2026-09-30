/**
 * LogView: a focusable `log` region of monospace lines in the inset well, the latest line of a
 * running job in the body ink.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { LogView } from "../src/components/data/log-view/log-view";
import { classTokens, renderStatic } from "../src/testing";

const LINES = ["pulling image", "extracting", "starting server"];

describe("LogView", () => {
  it("is a named, focusable log region in the inset well", () => {
    const html = renderStatic(createElement(LogView, { lines: LINES, label: "Update output" }));
    expect(html).toMatch(/^<pre role="log" aria-label="Update output" tabindex="0" class="/);
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-surface-inset", "font-mono", "overflow-auto", "max-h-64"]),
    );
    expect(html).toContain("pulling image\nextracting\nstarting server</pre>");
  });

  it("brightens the last line only when asked", () => {
    const html = renderStatic(createElement(LogView, { lines: LINES, highlightLast: true }));
    expect(html).toContain('extracting\n<span class="text-fg">starting server</span></pre>');
    const one = renderStatic(createElement(LogView, { lines: ["done"], highlightLast: true }));
    expect(one).toMatch(/class="[^"]*"><span class="text-fg">done<\/span><\/pre>$/);
  });
});
