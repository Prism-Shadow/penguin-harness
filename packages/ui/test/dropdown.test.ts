/**
 * The dropdown panel (src/components/overlays/dropdown/dropdown.tsx) and the form-style picker
 * built on it (src/components/forms/select/form-picker.tsx).
 *
 * The panel mounts only while open, and its portal mode reaches for `document.body`, which a
 * static render has none of; the in-flow panel renders, and what the portal path must keep doing
 * (share the dialogs' focusable set and Escape stack, and focus its first item once placed) is
 * pinned against the source. How the app's
 * menus consult the scroll rule is `context-menu.test.ts`; that dialogs and menus share one
 * focusable selector is the web app's `modal-focus.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FormPicker, FormPickerTrigger } from "../src/components/forms/select/form-picker";
import { Dropdown } from "../src/components/overlays/dropdown/dropdown";
import { menuPanelClass } from "../src/components/overlays/menu-panel/menu-panel";
import { classTokens, renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

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
    expect(html).toBe('<div class="relative flex-1"><button type="button">Open</button></div>');
  });

  it("opens the menu panel in flow, on the menu tier, as a glass layer", () => {
    const html = renderStatic(
      createElement(Dropdown, { button: trigger, open: true, setOpen: () => {}, children: row }),
    );
    const tokens = classTokens(html);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "ui-glass",
        ...menuPanelClass.split(" "),
        "absolute",
        "z-40",
        "max-h-[70vh]",
        // The default docking: downward, left-aligned, capped to the viewport.
        "top-full",
        "left-0",
        "w-64",
      ]),
    );
    expect(html).toContain("Rename</button></div></div>");
  });

  it("takes the caller's size classes and inline overrides for the panel", () => {
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
    expect(classTokens(html)).toContain("w-40");
    expect(classTokens(html)).not.toContain("w-64");
  });

  it("walks the dialogs' focusable set and joins their Escape stack", () => {
    const source = readFileSync(join(SRC_DIR, "components/overlays/dropdown/dropdown.tsx"), "utf8");
    expect(source).toContain('from "../esc-layers/esc-layers"');
    expect(source).toContain("querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)");
    expect(source).toMatch(/const layer = pushEscLayer\(\);[\s\S]*isTopEscLayer\(layer\)/);
    // Portaled panels clear a dialog's overlay; in-flow ones stay on the menu tier.
    expect(source).toContain('${portal ? "z-[60]" : "z-40"}');
  });

  it("focuses a portaled panel's first item only once the panel is placed", () => {
    // Until placed, the portaled panel is `visibility: hidden`, which cannot take focus: a
    // focus attempted then would leave the keyboard on the trigger with the menu open.
    const source = readFileSync(join(SRC_DIR, "components/overlays/dropdown/dropdown.tsx"), "utf8");
    expect(source).toContain("const placed = !portal || pos !== null;");
    expect(source).toMatch(
      /if \(!open \|\| !placed \|\| focusOnOpenRef\.current === false\) return;\s*panelItems\(\)\[0\]\?\.focus\(\);\s*\}, \[open, placed, panelItems\]\);/,
    );
    expect(source).toContain('visibility: "hidden" as const');
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

  it("is a full-width trigger that names itself and the list it opens", () => {
    const html = picker(false);
    expect(html).toContain('aria-label="Choose a model"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    // The hint goes through the shared tooltip, never a native title.
    expect(html).toContain('data-tooltip="Model"');
    expect(html).not.toContain("title=");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["w-full", "truncate"]));
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

  it("greys a placeholder with the subtle ink, and colours only through tokens", () => {
    const tokens = classTokens(picker(true));
    expect(tokens).toContain("text-fg-subtle");
    expect(tokens.filter((t) => /gray|dark:/.test(t))).toEqual([]);
  });
});
