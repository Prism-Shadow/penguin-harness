// @vitest-environment jsdom
/**
 * The organization handbook's document editor (features/company/handbook-page.tsx) under the
 * settings commit model, against a fake of the handbook routes.
 *
 * - Save waits until the text differs from the document as stored, then writes it and goes back
 *   to reading the document.
 * - Every in-page step that would throw unsaved text away asks first, through the app's one
 *   prompt: Cancel, and choosing another document. "Keep editing" keeps the text; "discard"
 *   takes the step. While the text is unsaved, the page counts as holding unsaved edits, which
 *   is what a route change or a reload asks about.
 * - The new-document dialog waits for a path that names a document the handbook does not hold,
 *   saying a taken one under the field as it is typed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { button, click, dialogs, field, hasButton, type, unmountAll, waitFor } from "./helpers/dom";
import { openHandbook } from "./helpers/handbook";

const editor = () => field("README.md");
const promptOpen = () => hasButton(en.common.discard);

describe("the handbook editor", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    localStorage.setItem("penguin.lang", "en");
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("waits for an edit before Save goes live, then writes the text", async () => {
    const network = await openHandbook();
    await click(button(en.common.edit));
    expect(button(en.common.save).disabled).toBe(true);
    await type(editor(), "# Index\n\nRead this first.");
    await click(button(en.common.save));
    await waitFor(() => network.requests.some((r) => r.method === "PUT"));
    expect(network.requests.find((r) => r.method === "PUT")!.body).toEqual({
      content: "# Index\n\nRead this first.",
    });
    await waitFor(() => hasButton(en.common.edit));
    expect(document.body.textContent).toContain("Read this first.");
  });

  it("asks before Cancel throws the text away, and counts it unsaved meanwhile", async () => {
    await openHandbook();
    await click(button(en.common.edit));
    await type(editor(), "# Index, rewritten");
    expect(hasUnsaved()).toBe(true);
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(editor().value).toBe("# Index, rewritten");

    await click(button(en.common.cancel));
    await click(button(en.common.discard));
    expect(hasButton(en.common.edit)).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("asks before another document replaces the text, and switches only on discard", async () => {
    await openHandbook();
    await click(button(en.common.edit));
    await type(editor(), "# Index, rewritten");
    await click(document.querySelector('[data-tree-path="conventions.md"]')!);
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(editor().value).toBe("# Index, rewritten");

    await click(document.querySelector('[data-tree-path="conventions.md"]')!);
    await click(button(en.common.discard));
    await waitFor(() => document.body.textContent?.includes("Conventions") === true);
    expect(hasUnsaved()).toBe(false);
  });

  it("waits for a path naming a document the handbook does not hold", async () => {
    await openHandbook();
    await click(button(en.company.handbook.newDocument));
    expect(dialogs()).toHaveLength(1);
    expect(button(en.common.create).disabled).toBe(true);
    await type(field(en.company.handbook.pathField), "conventions");
    expect(document.body.textContent).toContain(en.company.handbook.pathExists);
    expect(button(en.common.create).disabled).toBe(true);
    await type(field(en.company.handbook.pathField), "decisions");
    expect(button(en.common.create).disabled).toBe(false);
  });
});
