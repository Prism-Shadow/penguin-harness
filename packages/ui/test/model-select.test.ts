/**
 * The model picker (src/components/chat/model-select/model-select.tsx): the panel draws the rows
 * the caller's `view` answers with — logo, name, the "Free" badge, the no-key mark, the default
 * marker, the check on the model in effect — in the caller's words, and offers the reveal row
 * only while the caller holds models back; the trigger is the composer's pill or a dialog's form
 * field, named and hinted by the caller.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ModelMenuList, ModelSelect } from "../src/components/chat/model-select/model-select";
import type {
  ModelMenuLabels,
  ModelMenuQuery,
  ModelOption,
} from "../src/components/chat/model-select/model-select";
import { classTokens, renderStatic } from "../src/testing";

const LABELS: ModelMenuLabels = {
  search: "Search models",
  empty: "No matching models",
  free: "Free",
  noKey: "No API key",
  isDefault: "default",
  showHidden: (n) => `Show ${n} models without a key`,
};

const OPTIONS: ModelOption[] = [
  { key: "openai:gpt", provider: "openai", label: "GPT", isDefault: true },
  { key: "free:mini", provider: "custom", label: "Mini", free: true, noKey: true },
];

const panel = (hidden: number, seen: { query: string; showAll: boolean }[] = []) => {
  const view: ModelMenuQuery<ModelOption> = (state) => {
    seen.push(state);
    return { options: OPTIONS, hidden };
  };
  return renderStatic(
    createElement(ModelMenuList<ModelOption>, {
      view,
      currentKey: "openai:gpt",
      labels: LABELS,
      onPick: () => {},
    }),
  );
};

describe("ModelMenuList", () => {
  it("asks the caller for the rows, starting from an empty search with nothing revealed", () => {
    const seen: { query: string; showAll: boolean }[] = [];
    panel(0, seen);
    expect(seen[0]).toEqual({ query: "", showAll: false });
  });

  it("draws each model's marks in the caller's words, and checks the one in effect", () => {
    const html = panel(0);
    expect(html).toContain('placeholder="Search models"');
    expect(html).toContain(">GPT</span>");
    expect(html).toContain(">default</span>");
    expect(html).toContain(">Free</span>");
    expect(html).toContain('aria-label="No API key"');
    expect(html).toContain('role="img"');
    const rows = html.split("<button").slice(1);
    expect(rows[0]).toContain("GPT");
    expect(classTokens(`<b${rows[0]!}`)).toContain("bg-surface-muted");
    expect(classTokens(html)).toContain("text-tone-info-fg");
  });

  it("offers the reveal row only while the caller holds models back", () => {
    expect(panel(0)).not.toContain("without a key");
    expect(panel(3)).toContain("Show 3 models without a key");
  });
});

describe("ModelSelect", () => {
  const trigger = (variant: "pill" | "form", provider: string | null = "openai") =>
    renderStatic(
      createElement(ModelSelect, {
        label: "GPT",
        provider,
        ariaLabel: "Choose model",
        tooltip: "Choose model: GPT",
        variant,
        children: () => createElement("p", null, "PANEL"),
      }),
    );

  it("is the toolbar pill: the logo, the name hidden on a narrow card, the caret", () => {
    const html = trigger("pill");
    expect(html).toContain('aria-label="Choose model"');
    expect(html).toContain('data-tooltip="Choose model: GPT"');
    expect(html).toContain(">GPT</span>");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["@md:block", "max-w-44"]));
    // The panel mounts only while open.
    expect(html).not.toContain("PANEL");
  });

  it("is a dialog's form field, and draws no logo where no provider is named", () => {
    const named = trigger("form");
    expect(named).toContain('aria-label="Choose model"');
    expect(named).toContain('aria-haspopup="listbox"');
    expect(classTokens(named)).toContain("w-full");
    const svgs = (html: string) => html.match(/<svg/g)?.length ?? 0;
    expect(svgs(trigger("form", null))).toBe(svgs(named) - 1);
  });
});
