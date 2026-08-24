/**
 * The "?" disclosure (src/components/ui/info-popover.tsx) and the field layout it forces.
 *
 * The trap these guard is HTML's, not React's: an info trigger is a `<button>`, a `<button>` is
 * a labelable element, and a wrapping `<label>` names its FIRST labelable descendant. Nesting a
 * trigger inside `Field`'s usual `<label>` wrapper would therefore retarget the field's title
 * from the input to the "?" — silently, with no visual symptom.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InfoPopover } from "../src/components/ui/info-popover";
import { Field } from "../src/components/ui/field";
import { Input } from "../src/components/ui/input";
import { Switch } from "../src/components/ui/switch";
import { PrefRow } from "../src/features/settings/setting-row";
import { S } from "../src/lib/strings";

describe("InfoPopover", () => {
  const html = renderToStaticMarkup(
    createElement(InfoPopover, { children: "Values take effect from the next task." }),
  );

  it("is a real button carrying an accessible name", () => {
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain(`aria-label="${S.common.moreInfo}"`);
    expect(html).toContain(`title="${S.common.moreInfo}"`);
  });

  it("starts collapsed, and points at the panel it will open", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    // The panel is portaled and only mounted while open, so nothing of the text is in the tree.
    expect(html).not.toContain("Values take effect");
    expect(html).not.toContain('role="tooltip"');
  });

  it("folds the subject into its name rather than repeating it", () => {
    // A trigger inside a heading would otherwise make that heading announce its own title twice.
    const named = renderToStaticMarkup(
      createElement(InfoPopover, { label: "Vault", children: "x" }),
    );
    expect(named).toContain(`aria-label="${S.common.moreInfoAbout("Vault")}"`);
    expect(named).not.toContain('aria-label="Vault"');
  });
});

describe("Field with an info popover", () => {
  const withInfo = renderToStaticMarkup(
    createElement(Input, {
      label: "Timeout",
      info: "Per-request timeout.",
      hint: "milliseconds",
      value: "",
      readOnly: true,
    }),
  );

  it("associates the title by htmlFor instead of wrapping the control", () => {
    const forMatch = /<label for="([^"]+)"/.exec(withInfo);
    expect(forMatch, "the title must be a <label for=…>").not.toBeNull();
    expect(withInfo).toContain(`id="${forMatch?.[1]}"`);
  });

  it("never puts the trigger inside a label element", () => {
    // Everything between a <label> open tag and its close must be free of <button>.
    for (const [, inner] of withInfo.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
      expect(inner).not.toContain("<button");
    }
  });

  it("keeps a formatting hint visible alongside the disclosed semantics", () => {
    // The split is the whole point: what the field MEANS is disclosed, what shape the value must
    // take stays on screen while the user types.
    expect(withInfo).toContain("milliseconds");
    expect(withInfo).not.toContain("Per-request timeout.");
  });

  it("keeps the plain wrapping-label layout when there is no info", () => {
    const plain = renderToStaticMarkup(
      createElement(Field, { label: "Name", children: createElement("input", {}) }),
    );
    expect(plain.startsWith("<label")).toBe(true);
    expect(plain).not.toContain("<label for=");
  });
});

describe("PrefRow with an info popover", () => {
  // A System settings row titles a control it does not own, so its title is a <p> and the "?"
  // is safe beside it. An edit that made that title a <label> for the sake of click-to-toggle
  // would hand the row to the trigger instead — the same trap Field carries two layouts to
  // avoid, on the one row primitive that has no Field between it and the control.
  const row = renderToStaticMarkup(
    createElement(PrefRow, {
      label: "Theme",
      info: "Light or dark look of the app.",
      children: createElement(Switch, { checked: true, onChange: () => {} }),
    }),
  );

  it('keeps the row out of a label, so the "?" cannot toggle its control', () => {
    expect(row).not.toContain("<label");
    expect(row).toContain('role="switch"');
  });

  it("anchors the trigger to the row title", () => {
    expect(row).toContain(`aria-label="${S.common.moreInfoAbout("Theme")}"`);
    expect(row).not.toContain("Light or dark look of the app.");
  });
});
