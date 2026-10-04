/**
 * The A2UI blocks (src/components/content/a2ui): an ```a2ui fence parsed by the grammar and drawn
 * by its type's renderer — a choice, a form, steps, a callout — and a ```mermaid fence drawn as a
 * diagram; read-only unless a host hands them actions; the source and a notice for anything that
 * cannot be drawn; a placeholder while the reply streams; and Md routing both fences to them.
 *
 * Static markup only: a pick's fill and the diagram's drawing run in the browser. The pieces of
 * that logic which decide something — the form's gate and its answers, a number's step, the
 * arrow-key walk, which options fit one row — are pure and called directly.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { A2uiForm } from "@prismshadow/penguin-core/a2ui";
import { A2uiActionsProvider } from "../src/components/content/a2ui/actions";
import type { A2uiActions } from "../src/components/content/a2ui/actions";
import { A2uiBlock } from "../src/components/content/a2ui/a2ui-block";
import { filledAnswers, formReady } from "../src/components/content/a2ui/form-answers";
import { MermaidBlock } from "../src/components/content/a2ui/mermaid-block";
import { NumberField, stepNumber } from "../src/components/content/a2ui/number-field";
import { rovingTarget, shortOptions } from "../src/components/content/a2ui/parts";
import { a2uiRendererFor, registerA2uiRenderer } from "../src/components/content/a2ui/registry";
import { Md } from "../src/components/content/prose/prose";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const LIVE: A2uiActions = { interactive: true, fill: () => {}, lang: "en" };

const block = (spec: object, actions?: A2uiActions) => {
  const element = createElement(A2uiBlock, { source: JSON.stringify(spec) });
  return renderStatic(
    actions === undefined
      ? element
      : createElement(A2uiActionsProvider, { value: actions, children: element }),
  );
};

const CHOICE = {
  type: "choice",
  question: "Which database should the service use?",
  options: [
    {
      label: "PostgreSQL",
      description: "Relational, the team runs it already",
      recommended: true,
    },
    { label: "SQLite", value: "SQLite, one file beside the service" },
    { label: "MongoDB" },
  ],
};

const FORM: A2uiForm = {
  type: "form",
  title: "Deployment",
  fields: [
    {
      id: "region",
      label: "Region",
      kind: "single",
      options: [{ label: "eu-west" }, { label: "us-east" }],
      required: true,
    },
    {
      id: "features",
      label: "Features",
      kind: "multiple",
      options: [{ label: "CDN" }, { label: "WAF" }],
    },
    { id: "name", label: "Service name", kind: "text", placeholder: "billing-api" },
    { id: "replicas", label: "Replicas", kind: "number", min: 1, max: 10, step: 1, unit: "pods" },
  ],
};

/** Every `<button>` opening tag. */
const buttons = (html: string) => html.match(/<button\b[^>]*>/g) ?? [];

/** A card's leading disc, the radio's drawing. */
const DISC = /size-3\.5 shrink-0 rounded-full/;

describe("ChoiceBlock", () => {
  it("shows the question, every option, its description and the recommended mark", () => {
    const html = block(CHOICE);
    expect(html).toContain('data-a2ui="choice"');
    expect(html).toContain("Which database should the service use?");
    for (const label of ["PostgreSQL", "SQLite", "MongoDB"]) expect(html).toContain(label);
    expect(html).toContain("Relational, the team runs it already");
    expect(html.match(/Recommended/g)).toHaveLength(1);
  });

  it("is read-only by default: every option disabled, nothing to fill", () => {
    const tags = buttons(block({ ...CHOICE, allowOther: true }));
    expect(tags).toHaveLength(4);
    for (const tag of tags) expect(tag).toContain('disabled=""');
  });

  it("live, makes a single choice one tab stop that starts on the recommended option", () => {
    const tags = buttons(block({ ...CHOICE, allowOther: true }, LIVE));
    expect(tags).toHaveLength(4);
    expect(tags.filter((tag) => tag.includes('tabindex="0"'))).toHaveLength(1);
    expect(tags[0]).toContain('tabindex="0"');
    for (const tag of tags) expect(tag).not.toContain('disabled=""');
    expect(block({ ...CHOICE, allowOther: true }, LIVE)).toContain("Other…");
  });

  it("collects a multi-select in checkboxes behind a fill button that waits for a pick", () => {
    const html = block({ ...CHOICE, multiple: true }, LIVE);
    expect(html.match(/<input type="checkbox"/g)).toHaveLength(3);
    const [fill] = buttons(html);
    expect(html).toContain("Fill in");
    expect(fill).toContain('disabled=""');
    expect(block({ ...CHOICE, multiple: true })).not.toContain("Fill in");
  });

  it("sets a few short options as a row of chips, and longer ones as cards led by a disc", () => {
    const short = {
      type: "choice",
      question: "Merge it now?",
      options: [
        { label: "Now", recommended: true },
        { label: "After review" },
        { label: "Not yet" },
      ],
    };
    const chips = block(short, LIVE);
    for (const tag of buttons(chips)) expect(tag).toContain("rounded-control");
    expect(chips).not.toMatch(DISC);
    const cards = block(CHOICE, LIVE);
    for (const tag of buttons(cards)) expect(tag).toContain("rounded-md");
    expect(cards.match(new RegExp(DISC, "g"))).toHaveLength(3);
  });
});

describe("shortOptions", () => {
  it("fits a row only with few options, no description, and labels counted in code points", () => {
    const labels = (...names: string[]) => names.map((label) => ({ label }));
    expect(shortOptions(labels("Yes", "No"), 4, 20)).toBe(true);
    expect(shortOptions(labels("a", "b", "c", "d", "e"), 4, 20)).toBe(false);
    expect(shortOptions([{ label: "Yes", description: "Ship it" }, { label: "No" }], 4, 20)).toBe(
      false,
    );
    // Twenty CJK characters are twenty code points: the limit counts characters, not width.
    const twenty = "现在合并并且发布到生产环境里去吧今天下午";
    expect(shortOptions(labels(twenty, "No"), 4, 20)).toBe(true);
    expect(shortOptions(labels(`${twenty}吗`, "No"), 4, 20)).toBe(false);
  });
});

describe("FormBlock", () => {
  it("draws each field kind as its control, with the number's range, unit and stepper", () => {
    const html = block(FORM, LIVE);
    expect(html).toContain('data-a2ui="form"');
    // Two short options each: a segmented control for the single, toggle chips for the multiple.
    expect(html).not.toMatch(/<input type="(?:radio|checkbox)"/);
    expect(classTokens(html)).toContain("grid-cols-[repeat(2,1fr)]");
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(html).toMatch(/<input[^>]*placeholder="billing-api"/);
    expect(html).toMatch(/<input[^>]*type="number"[^>]*min="1" max="10" step="1"/);
    expect(html).toContain("pods");
    expect(html).toContain("1–10");
    expect(html).toContain('aria-label="Decrease"');
    expect(html).toContain('aria-label="Increase"');
  });

  it("keeps radios and checkboxes for options that carry a description", () => {
    const described = {
      ...FORM,
      fields: FORM.fields.map((field) =>
        field.options === undefined
          ? field
          : { ...field, options: field.options.map((o) => ({ ...o, description: "Details" })) },
      ),
    };
    const html = block(described, LIVE);
    expect(html.match(/<input type="radio"/g)).toHaveLength(2);
    expect(html.match(/<input type="checkbox"/g)).toHaveLength(2);
  });

  it("marks a required field and holds the fill button until the form is ready", () => {
    const html = block(FORM, LIVE);
    expect(html).toContain('aria-hidden="true">*</span>');
    expect(buttons(html).at(-1)).toMatch(/type="submit"[^>]*disabled=""/);
    const readOnly = block(FORM);
    expect(readOnly).not.toContain('type="submit"');
    expect(readOnly.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
  });

  it("steps a number by its step within the range, and disables a step past a bound", () => {
    const replicas = FORM.fields[3]!;
    const stepper = (value: string, disabled = false) =>
      buttons(
        renderStatic(
          createElement(NumberField, {
            field: replicas,
            value,
            onChange: () => {},
            disabled,
            strings: DEFAULT_UI_STRINGS.a2ui,
          }),
        ),
      );
    const [down, up] = stepper("10");
    expect(up).toContain('disabled=""');
    expect(down).not.toContain('disabled=""');
    expect(stepper("1")[0]).toContain('disabled=""');
    for (const tag of stepper("5", true)) expect(tag).toContain('disabled=""');
    expect(stepNumber("", replicas, 1)).toBe("1");
    expect(stepNumber("12", replicas, -1)).toBe("10");
    expect(stepNumber("0.1", { ...replicas, min: 0, max: 1, step: 0.2 }, 1)).toBe("0.3");
  });

  it("gates on required fields and numbers in range, and fills only what was answered", () => {
    expect(formReady(FORM, {})).toBe(false);
    expect(formReady(FORM, { name: "api" })).toBe(false);
    expect(formReady(FORM, { region: "eu-west" })).toBe(true);
    expect(formReady(FORM, { region: "eu-west", replicas: "12" })).toBe(false);
    expect(formReady(FORM, { region: "eu-west", replicas: "two" })).toBe(false);
    expect(
      filledAnswers(FORM, { region: "eu-west", features: [], name: "  api  ", replicas: "3" }),
    ).toEqual({ region: "eu-west", name: "api", replicas: "3" });
  });
});

describe("StepsBlock", () => {
  it("puts a step's warning and caution before its instruction and its note after", () => {
    const html = block({
      type: "steps",
      title: "Rotate the key",
      steps: [
        { text: "Open the settings." },
        {
          text: "Delete the old key.",
          warning: "Deleted keys cannot be restored.",
          caution: "Running jobs fail until they restart.",
          note: "The new key works at once.",
          code: "penguin keys rotate",
          lang: "bash",
        },
      ],
    });
    const at = (text: string) => html.indexOf(text);
    expect(at("Deleted keys")).toBeLessThan(at("Delete the old key."));
    expect(at("Running jobs")).toBeLessThan(at("Delete the old key."));
    expect(at("The new key works")).toBeGreaterThan(at("Delete the old key."));
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-tone="caution"');
    expect(html).toContain('data-tone="note"');
    expect(html).toContain("code-block");
    expect(html).toContain("penguin keys rotate");
    expect(html).toMatch(/<ol role="list"/);
    // A timeline: one rule from the first disc to the second, none after the last.
    expect(html.match(/after:w-px/g)).toHaveLength(1);
  });
});

describe("CalloutBlock", () => {
  const callout = (spec: Record<string, unknown>) =>
    renderStatic(
      createElement(UiStringsProvider, {
        strings: { ...DEFAULT_UI_STRINGS, a2ui: { ...DEFAULT_UI_STRINGS.a2ui, tip: "Hint" } },
        children: createElement(A2uiBlock, {
          source: JSON.stringify({ type: "callout", ...spec }),
        }),
      }),
    );

  it("is one row: the tone's mark says the tone, no title line names it", () => {
    const html = callout({ tone: "tip", text: "Run `pnpm test` first." });
    expect(html).toContain('data-tone="tip"');
    expect(html).toContain('data-tooltip="Hint"');
    expect(html).toContain('<span class="sr-only">Hint: </span>');
    expect(html).toContain("<code>pnpm test</code>");
    expect(html).not.toContain("ui-notice");
    expect(html).not.toContain('data-slot="title"');
  });

  it("leads the text with the model's title in the same line", () => {
    const html = callout({ tone: "tip", title: "Faster", text: "Cache the build." });
    expect(html).toMatch(/<span class="font-semibold">Faster <\/span>Cache the build\./);
  });
});

describe("A2uiBlock", () => {
  it("shows the source and a notice for a block the grammar rejects, never an empty box", () => {
    for (const source of ['{"type": "choice", "question": ', '{"type": "slider", "min": 0}']) {
      const html = renderStatic(createElement(A2uiBlock, { source }));
      expect(html).toContain('data-a2ui="invalid"');
      expect(html).toContain("be shown:");
      expect(html).toContain("code-block");
      expect(html).toContain(source.replace(/"/g, "&quot;"));
      expect(html).not.toContain("data-reveal");
    }
  });

  it("brings a block that draws in under the theme's reveal", () => {
    expect(block(CHOICE)).toMatch(/^<div data-reveal="true"><div class="a2ui-block/);
  });

  it("is a placeholder while the reply streams, and parses nothing", () => {
    const source = '{"type": "cho';
    const html = renderStatic(createElement(A2uiBlock, { source, streaming: true }));
    expect(html).toContain("Composing…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("cho");
  });
});

describe("registerA2uiRenderer", () => {
  const Plain = ({ spec }: { spec: { text: string } }): ReactElement =>
    createElement("aside", null, spec.text);

  it("draws a type with the registered renderer until it is unregistered", () => {
    const callout = { type: "callout", tone: "note", text: "Plain words." };
    const builtIn = a2uiRendererFor("callout");
    const unregister = registerA2uiRenderer("callout", Plain);
    expect(block(callout)).toContain("<aside>Plain words.</aside>");
    unregister();
    expect(a2uiRendererFor("callout")).toBe(builtIn);
    expect(block(callout)).toContain('data-a2ui="callout"');
  });

  it("ignores a stale unregister once the type was registered again", () => {
    const first = registerA2uiRenderer("callout", Plain);
    const Other = () => createElement("aside", null, "other");
    const second = registerA2uiRenderer("callout", Other);
    first();
    expect(a2uiRendererFor("callout")).toBe(Other);
    second();
  });
});

describe("MermaidBlock", () => {
  const FLOW = "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]";

  it("waits for the renderer before drawing a valid diagram, without showing its source", () => {
    const html = renderStatic(createElement(MermaidBlock, { source: FLOW }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Diagram");
    expect(html).not.toContain("code-block");
  });

  it("shows the source and a notice for a diagram the grammar rejects", () => {
    const source = 'flowchart TD\n  A --> B\n  click A "https://example.com"';
    const html = renderStatic(createElement(MermaidBlock, { source }));
    expect(html).toContain('data-a2ui="invalid"');
    expect(html).toContain("be shown:");
    expect(html).toContain("click A");
  });
});

describe("Md fences", () => {
  const fence = (language: string, body: string) =>
    `Pick one:\n\n\`\`\`${language}\n${body}\n\`\`\`\n`;

  it("draws an a2ui fence as its block and a mermaid fence as a diagram, not as code", () => {
    const a2ui = renderStatic(createElement(Md, { text: fence("a2ui", JSON.stringify(CHOICE)) }));
    expect(a2ui).toContain('data-a2ui="choice"');
    expect(a2ui).not.toContain("code-block");
    const mermaid = renderStatic(
      createElement(Md, { text: fence("mermaid", "sequenceDiagram\n  A->>B: hi") }),
    );
    expect(mermaid).toContain("Diagram");
    expect(mermaid).not.toContain("code-block");
  });

  it("holds both behind the placeholder while the reply streams", () => {
    for (const language of ["a2ui", "mermaid"]) {
      const html = renderStatic(
        createElement(Md, { text: fence(language, '{"type": "choice"'), streaming: true }),
      );
      expect(html, language).toContain("Composing…");
      expect(html, language).not.toContain("code-block");
    }
  });
});

describe("rovingTarget", () => {
  it("walks the group on either axis, wraps at the ends, and ignores other keys", () => {
    expect(rovingTarget(0, "ArrowDown", 3)).toBe(1);
    expect(rovingTarget(2, "ArrowRight", 3)).toBe(0);
    expect(rovingTarget(0, "ArrowUp", 3)).toBe(2);
    expect(rovingTarget(1, "Home", 3)).toBe(0);
    expect(rovingTarget(0, "End", 3)).toBe(2);
    expect(rovingTarget(0, "Enter", 3)).toBeNull();
  });
});
