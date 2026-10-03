/**
 * The text fallback and the composer fill texts (a2ui/fallback.ts): each block type as readable
 * Markdown in both languages, mermaid and invalid blocks left untouched, and the exact strings a
 * pick fills — the model reads them as ordinary user text next turn.
 */
import { describe, expect, it } from "vitest";
import {
  choiceFillText,
  formFillText,
  toFallbackMarkdown,
  type A2uiChoice,
  type A2uiForm,
} from "../src/a2ui/index.js";

const fence = (spec: unknown) => `\`\`\`a2ui\n${JSON.stringify(spec)}\n\`\`\``;

const choice: A2uiChoice = {
  type: "choice",
  question: "Which?",
  options: [
    { label: "A", value: "Use A", description: "first", recommended: true },
    { label: "B" },
  ],
};

describe("toFallbackMarkdown", () => {
  it("a choice becomes the bold question, a numbered list and the reply hint, in the reply's language", () => {
    expect(toFallbackMarkdown(`Pick one.\n\n${fence(choice)}\n`)).toBe(
      "Pick one.\n\n**Which?**\n\n1. A — first (recommended)\n2. B\n\nReply with a number or your own answer.\n",
    );
    expect(toFallbackMarkdown(fence(choice), { lang: "zh" })).toBe(
      "**Which?**\n\n1. A — first（推荐）\n2. B\n\n回复编号或直接写出你的答案。",
    );
  });

  it("a form becomes one bullet per field with its options, range and unit inline", () => {
    const form: A2uiForm = {
      type: "form",
      title: "Size",
      fields: [
        { id: "size", label: "Size", kind: "number", min: 1, max: 10, unit: "GB", required: true },
        { id: "kind", label: "Kind", kind: "single", options: [{ label: "A" }, { label: "B" }] },
      ],
    };
    expect(toFallbackMarkdown(fence(form), { lang: "en" })).toBe(
      "**Size**\n\n- **Size** (required): 1–10 GB\n- **Kind**: A / B\n\nReply with one line per field.",
    );
  });

  it("steps become a numbered list with the warning above the step, the note below, and the code as a fence", () => {
    const steps = {
      type: "steps",
      steps: [
        { warning: "Back up.", text: "Delete it.", code: "rm x", lang: "sh" },
        { text: "Start again.", note: "Takes a minute." },
      ],
    };
    expect(toFallbackMarkdown(fence(steps), { lang: "en" })).toBe(
      [
        "1. **WARNING:** Back up.",
        "",
        "   Delete it.",
        "",
        "   ```sh",
        "   rm x",
        "   ```",
        "2. Start again.",
        "",
        "   **NOTE:** Takes a minute.",
      ].join("\n"),
    );
  });

  it("a callout becomes a blockquote with a bold tone label, title included", () => {
    expect(
      toFallbackMarkdown(fence({ type: "callout", tone: "warning", text: "Careful." }), {
        lang: "en",
      }),
    ).toBe("> **Warning:** Careful.");
    expect(
      toFallbackMarkdown(fence({ type: "callout", tone: "note", title: "提示", text: "内容" }), {
        lang: "zh",
      }),
    ).toBe("> **说明：提示**\n>\n> 内容");
  });

  it("leaves mermaid fences, invalid blocks and unclosed fences as they are", () => {
    const mermaid = "Flow:\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    expect(toFallbackMarkdown(mermaid)).toBe(mermaid);
    const invalid = 'Note:\n\n```a2ui\n{"type":"nope"}\n```\n';
    expect(toFallbackMarkdown(invalid)).toBe(invalid);
    const unclosed = `Pick one.\n\n\`\`\`a2ui\n${JSON.stringify(choice)}`;
    expect(toFallbackMarkdown(unclosed)).toBe(unclosed);
  });
});

describe("fill texts", () => {
  it("a choice fills the picked options' values (default: label), joined with the language's separator", () => {
    expect(choiceFillText(choice, ["A"], "en")).toBe("Use A");
    expect(choiceFillText(choice, ["A", "B"], "en")).toBe("Use A, B");
    expect(choiceFillText(choice, ["A", "B"], "zh")).toBe("Use A、B");
    expect(choiceFillText(choice, ["something else"], "en")).toBe("something else");
  });

  it("a form fills one `label: answer` line per answered field, numbers with their unit, lists joined", () => {
    const form: A2uiForm = {
      type: "form",
      fields: [
        { id: "n", label: "Count", kind: "number", unit: "GB" },
        {
          id: "k",
          label: "Kind",
          kind: "multiple",
          options: [{ label: "A", value: "alpha" }, { label: "B" }],
        },
        { id: "t", label: "Notes", kind: "text" },
      ],
    };
    const answers = { n: "3", k: ["A", "B"], t: "" };
    expect(formFillText(form, answers, "en")).toBe("Count: 3 GB\nKind: alpha, B");
    expect(formFillText(form, answers, "zh")).toBe("Count：3 GB\nKind：alpha、B");
    expect(formFillText(form, {}, "en")).toBe("");
  });
});
