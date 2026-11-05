/**
 * The dropdown panel (src/components/overlays/dropdown/dropdown.tsx) and the form-style picker
 * built on it (src/components/forms/select/form-picker.tsx).
 *
 * The panel mounts only while open, and its portal mode reaches for `document.body`, which a
 * static render has none of; the in-flow panel renders here. On a real page,
 * overlay-layers.dom.test.ts holds its Escape layer (a menu inside a Drawer takes the first
 * Escape alone) and its wait for placement before it focuses the first item; the anchored
 * panel's scroll rule is context-menu.dom.test.ts. That dialogs and menus share one focusable
 * selector is the web app's `modal-focus.test.ts`.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FormPicker, FormPickerTrigger } from "../src/components/forms/select/form-picker";
import { Dropdown } from "../src/components/overlays/dropdown/dropdown";
import { menuPanelClass } from "../src/components/overlays/menu-panel/menu-panel";
import { classTokens, renderStatic, markupStructure } from "../src/testing";

const trigger = createElement("button", { type: "button" }, "Open");
const row = createElement("button", { type: "button" }, "Rename");

describe("Dropdown", () => {
  it("renders only its trigger while closed", () => {
    const html = renderStatic(
      createElement(Dropdown, {
        button: trigger,
        open: false,
        setOpen: () => {},
        className: "flex-1",
        children: row,
      }),
    );
    expect(markupStructure(html)).toBe('<div><button type="button">Open</button></div>');
  });

  it("opens the menu panel in flow, on the menu tier, as a glass layer", () => {
    const html = renderStatic(
      createElement(Dropdown, { button: trigger, open: true, setOpen: () => {}, children: row }),
    );
    const tokens = classTokens(html);
    expect(tokens).toEqual(expect.arrayContaining(["ui-glass", ...menuPanelClass.split(" ")]));
    expect(html).toContain("Rename</button></div></div>");
  });

  it("takes the caller's inline overrides for the panel", () => {
    const html = renderStatic(
      createElement(Dropdown, {
        button: trigger,
        open: true,
        setOpen: () => {},
        menuClass: "right-0 top-full w-40",
        menuStyle: { maxWidth: 320 },
        children: row,
      }),
    );
    expect(html).toContain('style="max-width:320px"');
  });
});

describe("FormPicker", () => {
  const picker = (muted: boolean) =>
    renderStatic(
      createElement(FormPicker, {
        open: false,
        setOpen: () => {},
        label: "gpt-5",
        muted,
        title: "Model",
        ariaLabel: "Choose a model",
        menuClass: "w-72",
        children: row,
      }),
    );

  it("is a trigger that names itself and the list it opens", () => {
    const html = picker(false);
    expect(html).toContain('aria-label="Choose a model"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    // The hint goes through the shared tooltip, never a native title.
    expect(html).toContain('data-tooltip="Model"');
    expect(html).not.toContain("title=");
  });

  it("hints only what the caller gives it: no title, no data-tooltip, the aria-label stays", () => {
    const html = renderStatic(
      createElement(FormPickerTrigger, {
        label: "3 picked",
        ariaLabel: "Plugins",
        expanded: false,
        onClick: () => {},
      }),
    );
    expect(html).toContain('aria-label="Plugins"');
    expect(html).not.toContain("data-tooltip");
    const titled = renderStatic(
      createElement(FormPickerTrigger, {
        label: "GPT-6",
        title: "Model: GPT-6",
        ariaLabel: "Model",
        expanded: false,
        onClick: () => {},
      }),
    );
    expect(titled).toContain('data-tooltip="Model: GPT-6"');
  });
});
