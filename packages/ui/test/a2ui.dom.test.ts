// @vitest-environment jsdom
/**
 * A choice block's "Other…" on a real page (test/helpers/dom.ts).
 *
 * - Given a single or a multiple choice that allows another answer, when the reader presses
 *   "Other…", the composer is emptied (`fill("")`) for the reader's own words.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { A2uiActionsProvider } from "../src/components/content/a2ui/actions";
import { A2uiBlock } from "../src/components/content/a2ui/a2ui-block";
import { mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const CHOICE = {
  type: "choice",
  question: "Which database should the service use?",
  options: [{ label: "SQLite" }, { label: "PostgreSQL" }, { label: "MongoDB" }],
  allowOther: true,
};

describe("a choice's Other…", () => {
  it.each([
    ["single", false],
    ["multiple", true],
  ])("empties the composer in a %s choice", async (_kind, multiple) => {
    const fill = vi.fn();
    await mount(
      createElement(A2uiActionsProvider, {
        value: { interactive: true, fill, lang: "en" },
        children: createElement(A2uiBlock, { source: JSON.stringify({ ...CHOICE, multiple }) }),
      }),
    );
    const other = [...document.querySelectorAll<HTMLElement>("button, [role='radio'], label")].find(
      (el) => el.textContent?.trim() === "Other…",
    );
    expect(other).toBeDefined();
    await act(async () => {
      other!.click();
    });
    expect(fill).toHaveBeenLastCalledWith("");
  });
});
