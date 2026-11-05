/**
 * OptionMenu (src/components/forms/select/option-menu.tsx): a compact trigger over a portaled
 * panel whose rows carry a title and a description. The panel mounts only while open, so the
 * trigger and the row-description record are what a static render can check.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { OptionMenu } from "../src/components/forms/select/option-menu";
import { renderStatic } from "../src/testing";

const options = [
  { value: "r", triggerLabel: "r", label: "Read only", description: "Reads the workspace." },
  { value: "rw", triggerLabel: "rw", label: "Read and write", description: "Changes files." },
] as const;

type Props = Parameters<typeof OptionMenu<"r" | "rw">>[0];

const render = (props: Partial<Props>) =>
  renderStatic(
    createElement(OptionMenu<"r" | "rw">, { options, value: null, onChange: () => {}, ...props }),
  );

describe("OptionMenu", () => {
  it("shows the current choice's compact label on a listbox trigger", () => {
    const html = render({ value: "rw", "aria-label": "Permission" });
    expect(html).toMatch(/^<button type="button" aria-label="Permission" aria-haspopup="listbox"/);
    expect(html).toContain(">rw</span>");
    expect(html).not.toContain("Read and write");
  });

  it("falls back to the placeholder, then to a dash, while nothing is chosen", () => {
    expect(render({ value: null, placeholder: "default" })).toContain(">default</span>");
    expect(render({ value: undefined })).toContain(">—</span>");
  });
});
