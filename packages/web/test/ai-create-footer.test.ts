/**
 * The "Create with AI" dialog's footer (src/features/ai-create/ai-create-modal.tsx): which of the
 * two exits is emphasised, and where it sits.
 *
 * A surface warns about what its prompt will carry and then recommends editing it first; that
 * recommendation only holds if the accent and the rightmost slot — the two things that say "this
 * is the action" — land on the same button. So both are asserted together, per `primaryExit`.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiCreateFooter } from "../src/features/ai-create/ai-create-modal";
import type { PrimaryExit } from "../src/features/ai-create/ai-create-modal";
import { S } from "../src/lib/strings";

/** The rendered `<button>` tags, in DOM order. */
function buttons(primaryExit: PrimaryExit): string[] {
  const html = renderToStaticMarkup(
    createElement(AiCreateFooter, {
      primaryExit,
      ready: true,
      onCancel: () => undefined,
      onGo: () => undefined,
    }),
  );
  return html.split("<button").slice(1);
}

/** Labels in footer order (left to right; the emphasised action is rightmost). */
function labels(primaryExit: PrimaryExit): string[] {
  const names: [string, string][] = [
    [S.common.cancel, "cancel"],
    [S.aiCreate.send, "send"],
    [S.aiCreate.editInChat, "edit"],
  ];
  return buttons(primaryExit).map(
    (b) => names.find(([label]) => b.includes(label))?.[1] ?? "unknown",
  );
}

/** The one button carrying the accent fill — Button's `primary` variant. */
function emphasised(primaryExit: PrimaryExit): number {
  const marked = buttons(primaryExit)
    .map((b, i) => (b.includes("--accent-bg") ? i : -1))
    .filter((i) => i !== -1);
  expect(marked).toHaveLength(1);
  return marked[0]!;
}

describe("AiCreateFooter", () => {
  it("emphasises Send by default, rightmost", () => {
    expect(labels("send")).toEqual(["cancel", "edit", "send"]);
    expect(emphasised("send")).toBe(2);
  });

  it("moves both the accent and the rightmost slot to Edit when the surface asks", () => {
    expect(labels("edit")).toEqual(["cancel", "send", "edit"]);
    expect(emphasised("edit")).toBe(2);
  });

  it("keeps Send available either way, and the wand welded to it", () => {
    for (const primaryExit of ["send", "edit"] as const) {
      const send = buttons(primaryExit).find((b) => b.includes(S.aiCreate.send));
      expect(send).toBeDefined();
      expect(send).toContain("<svg");
      expect(buttons(primaryExit).find((b) => b.includes(S.aiCreate.editInChat))).not.toContain(
        "<svg",
      );
    }
  });

  it("disables both exits until the prompt and the agent are ready, never Cancel", () => {
    const html = renderToStaticMarkup(
      createElement(AiCreateFooter, {
        primaryExit: "edit",
        ready: false,
        onCancel: () => undefined,
        onGo: () => undefined,
      }),
    );
    // `disabled=""` is the attribute; `disabled:` prefixes are Tailwind variants on every button.
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.split("<button")[1]).not.toContain('disabled=""');
  });
});
