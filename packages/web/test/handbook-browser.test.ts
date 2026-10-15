// @vitest-environment jsdom
/**
 * The organization handbook's browser (features/company/handbook-page.tsx) on the Files panel's
 * frame, against a fake of the handbook routes. The editor's own rules are handbook-editor-guard's.
 *
 * - The tree pane's filter narrows the tree to the documents whose path holds the text, opening
 *   the folders above them; a filter that matches nothing says so; clearing it gives the tree back.
 * - A link inside a document to another handbook document opens that document in place.
 * - Too narrow for two panes, the page shows the tree first; choosing a document replaces the
 *   tree with it, and the way back returns to the tree.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { button, click, field, hasButton, type, unmountAll, waitFor } from "./helpers/dom";
import { mountHandbook, openHandbook } from "./helpers/handbook";

const DOCUMENTS = {
  "README.md": "# Index\n\nStart with [the conventions](conventions.md).",
  "conventions.md": "# Conventions\n\nWrite dates as ISO 8601.",
  "decisions/2026-09-02-hire-plan.md": "# Hire plan",
  "roles/hr.md": "# HR",
};

/** The tree's rows on screen, by path. */
const treePaths = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-tree-path]")].map(
    (row) => row.dataset["treePath"]!,
  );

describe("the handbook browser", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    localStorage.setItem("penguin.lang", "en");
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("filters the tree by path, opening the folders above each match", async () => {
    await openHandbook(DOCUMENTS);
    expect(treePaths()).toEqual(["README.md", "decisions", "roles", "conventions.md"]);
    const filter = field(en.company.handbook.filterPlaceholder);
    await type(filter, "PLAN");
    expect(treePaths()).toEqual(["decisions", "decisions/2026-09-02-hire-plan.md"]);
    await type(filter, "nothing like this");
    expect(treePaths()).toEqual([]);
    expect(document.body.textContent).toContain(en.company.handbook.noMatch);
    await type(filter, "");
    expect(treePaths()).toEqual(["README.md", "decisions", "roles", "conventions.md"]);
  });

  it("opens a document a link inside another names, in place", async () => {
    const network = await openHandbook(DOCUMENTS);
    const link = [...document.querySelectorAll("a")].find(
      (a) => a.textContent === "the conventions",
    )!;
    await click(link);
    await waitFor(() => document.body.textContent?.includes("Write dates as ISO 8601.") === true);
    expect(network.requests.some((r) => r.path.endsWith("/conventions.md"))).toBe(true);
  });

  describe("too narrow for two panes", () => {
    // jsdom lays nothing out: every element measures 400px wide, the page's width here.
    const realRect = Element.prototype.getBoundingClientRect;
    beforeAll(() => {
      Element.prototype.getBoundingClientRect = (): DOMRect =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: 400,
          width: 400,
          height: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    });
    afterAll(() => {
      Element.prototype.getBoundingClientRect = realRect;
    });

    it("shows the tree, then the chosen document in its place, with a way back", async () => {
      await mountHandbook(DOCUMENTS);
      await waitFor(() => treePaths().includes("conventions.md"));
      expect(hasButton(en.files.backToList)).toBe(false);
      await click(document.querySelector('[data-tree-path="conventions.md"]')!);
      await waitFor(() => document.body.textContent?.includes("Write dates as ISO 8601.") === true);
      expect(treePaths()).toEqual([]);
      await click(button(en.files.backToList));
      expect(treePaths()).toContain("conventions.md");
    });
  });
});
