// @vitest-environment jsdom
/**
 * A typed form's draft against its baseline (`useFormDraft`) and a dialog's guarded close
 * (`useGuardedClose`), from the shared UI package, driven through a rendered form.
 *
 * - Typing makes the form dirty; typing the stored value back makes it clean again, and so does
 *   a value that differs only in what Save would normalise away (surrounding spaces).
 * - A cleared number is a different value from the stored one: dirty.
 * - Reset puts the stored value back; a successful save's adopt makes the answer the new
 *   baseline, clean.
 * - A reload of the stored value re-seeds a clean draft, and keeps a dirty one while moving
 *   its baseline.
 * - A dirty form is registered for every leave to find, and only while dirty.
 * - A dialog's guarded close asks about the dialog's own form alone: a dirty form on the page
 *   beneath neither holds the close nor gets discarded by it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, useState } from "react";
import { Modal, hasUnsaved, useFormDraft, useGuardedClose } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pressEscape,
  type,
  unmountAll,
} from "./helpers/dom";

/** What Save would send for a whole-MB limit: the trimmed number, or null for a cleared box. */
const limit = (text: string) => (text.trim() === "" ? null : Number(text.trim()));

function LimitForm({ stored }: { stored: string }) {
  const form = useFormDraft(stored, { normalize: limit });
  return h(
    "div",
    null,
    h("input", {
      "aria-label": "Limit",
      value: form.draft,
      onChange: (e: { target: { value: string } }) => form.setDraft(e.target.value),
    }),
    h("p", { "data-testid": "state" }, form.dirty ? "dirty" : "clean"),
    h("p", { "data-testid": "baseline" }, form.baseline),
    h("button", { type: "button", onClick: form.reset }, "Reset"),
    h(
      "button",
      { type: "button", onClick: () => form.adopt(limit(form.draft)!.toString()) },
      "Save",
    ),
  );
}

const state = () => document.querySelector('[data-testid="state"]')!.textContent;
const baseline = () => document.querySelector('[data-testid="baseline"]')!.textContent;

describe("a form's draft", () => {
  afterEach(async () => {
    await unmountAll();
  });

  it("is dirty once typed in, and clean again once the stored value is typed back", async () => {
    await mount(h(LimitForm, { stored: "100" }));
    expect(state()).toBe("clean");
    await type(field("Limit"), "120");
    expect(state()).toBe("dirty");
    await type(field("Limit"), "100");
    expect(state()).toBe("clean");
    await type(field("Limit"), " 100 ");
    expect(state()).toBe("clean");
  });

  it("counts a cleared number as a change", async () => {
    await mount(h(LimitForm, { stored: "100" }));
    await type(field("Limit"), "");
    expect(state()).toBe("dirty");
  });

  it("goes back to the stored value on reset, and takes a save's answer as the new baseline", async () => {
    await mount(h(LimitForm, { stored: "100" }));
    await type(field("Limit"), "120");
    await click(button("Reset"));
    expect(field("Limit").value).toBe("100");
    expect(state()).toBe("clean");
    await type(field("Limit"), " 150");
    await click(button("Save"));
    expect(field("Limit").value).toBe("150");
    expect(baseline()).toBe("150");
    expect(state()).toBe("clean");
  });

  it("follows a reload while clean, and keeps the typed text while dirty", async () => {
    const page = await mount(h(LimitForm, { stored: "100" }));
    await page.rerender(h(LimitForm, { stored: "110" }));
    expect(field("Limit").value).toBe("110");
    expect(state()).toBe("clean");
    await type(field("Limit"), "200");
    await page.rerender(h(LimitForm, { stored: "120" }));
    expect(field("Limit").value).toBe("200");
    expect(baseline()).toBe("120");
    await type(field("Limit"), "120");
    expect(state()).toBe("clean");
  });

  it("is registered for every leave to find while it is dirty, and only then", async () => {
    await mount(h(LimitForm, { stored: "100" }));
    expect(hasUnsaved()).toBe(false);
    await type(field("Limit"), "120");
    expect(hasUnsaved()).toBe(true);
    await type(field("Limit"), "100");
    expect(hasUnsaved()).toBe(false);
  });
});

/** A page with a typed field of its own and a record dialog holding another. */
function PageWithDialog({ onClose }: { onClose: () => void }) {
  const page = useFormDraft("page text");
  const [open, setOpen] = useState(true);
  return h(
    "div",
    null,
    h("input", {
      "aria-label": "Page field",
      value: page.draft,
      onChange: (e: { target: { value: string } }) => page.setDraft(e.target.value),
    }),
    open &&
      h(RecordDialog, {
        onClose: () => {
          setOpen(false);
          onClose();
        },
      }),
  );
}

function RecordDialog({ onClose }: { onClose: () => void }) {
  const form = useFormDraft("");
  const requestClose = useGuardedClose(onClose, form.scope);
  return h(Modal, {
    open: true,
    title: "New key",
    onClose: requestClose,
    children: h("input", {
      "aria-label": "Key",
      value: form.draft,
      onChange: (e: { target: { value: string } }) => form.setDraft(e.target.value),
    }),
  });
}

describe("a dialog's guarded close", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks about its own form alone, and leaves the page's draft untouched", async () => {
    const onClose = vi.fn();
    await mount(h("div", null, h(PageWithDialog, { onClose }), h(UnsavedPrompt)));
    await type(field("Page field"), "edited on the page");
    // The dialog itself is clean: Escape closes it without a question about the page.
    await pressEscape();
    expect(hasButton("Discard changes")).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()).toEqual([]);
    expect(field("Page field").value).toBe("edited on the page");
    expect(hasUnsaved()).toBe(true);
  });

  it("asks while its own form is dirty, and discarding resets only that form", async () => {
    const onClose = vi.fn();
    await mount(h("div", null, h(PageWithDialog, { onClose }), h(UnsavedPrompt)));
    await type(field("Page field"), "edited on the page");
    await type(field("Key"), "OPENAI_API_KEY");
    await pressEscape();
    expect(hasButton("Discard changes")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await click(button("Discard changes"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(field("Page field").value).toBe("edited on the page");
  });
});
