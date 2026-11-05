// @vitest-environment jsdom
/**
 * The finance page's in-place budget editor (features/company/finance-page.tsx).
 *
 * - Focus leaving the box writes nothing: only Enter or the check commits.
 * - Enter writes the typed amount, in USD whatever the reader's currency.
 * - A box holding another amount than the stored one counts as unsaved until it is cancelled,
 *   so leaving the page asks first; an untouched box does not.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { BudgetEditor } from "../src/features/company/finance-page";
import { field, mount, type, unmountAll } from "./helpers/dom";

async function openEditor(currency: "USD" | "CNY" = "USD") {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const editor = await mount(
    h(BudgetEditor, { initial: 50, name: "Writer", currency, busy: false, onSave, onCancel }),
  );
  return { editor, onSave, onCancel, box: field(en.company.finance.editBudgetOf("Writer")) };
}

async function dispatch(target: Element, event: Event) {
  await act(async () => {
    target.dispatchEvent(event);
  });
}

describe("the in-place budget editor", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("writes nothing when focus leaves the box", async () => {
    const { onSave, box } = await openEditor();
    await type(box, "80");
    await dispatch(
      box,
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("writes the typed amount on Enter, in USD", async () => {
    const usd = await openEditor();
    await type(usd.box, "80");
    await dispatch(usd.box, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(usd.onSave).toHaveBeenCalledWith(80);
    await unmountAll();

    const cny = await openEditor("CNY");
    await type(cny.box, "700");
    await dispatch(cny.box, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cny.onSave).toHaveBeenCalledWith(100);
  });

  it("counts an edited box as unsaved until it goes away, and an untouched one never", async () => {
    const { editor, box } = await openEditor();
    expect(hasUnsaved()).toBe(false);
    await type(box, "80");
    expect(hasUnsaved()).toBe(true);
    await type(box, "50");
    expect(hasUnsaved()).toBe(false);
    await type(box, "80");
    await editor.unmount();
    expect(hasUnsaved()).toBe(false);
  });
});
