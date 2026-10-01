/**
 * Adding a rule on the Project settings security page (components/layout/project-dialogs.tsx).
 *
 * - The rule editor puts the caret in its first field (the rule's name) and nowhere else, so
 *   opening the form is never silent.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RuleEditor } from "../src/components/layout/project-dialogs";

describe("command policy: adding a rule", () => {
  it("puts the caret in the first field, so the form is not silently opened", () => {
    const html = renderToStaticMarkup(
      createElement(RuleEditor, { initial: null, onApply: () => {}, onCancel: () => {} }),
    );
    // Exactly one field takes focus on mount, and it is the first one — the rule's name.
    expect(html.match(/autofocus/g) ?? []).toHaveLength(1);
    expect(/<input\b[^>]*>/.exec(html)?.[0] ?? "").toContain("autofocus");
  });
});
