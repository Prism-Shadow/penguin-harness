/**
 * Segmented (src/components/forms/segmented/segmented.tsx): options in a well, the chosen one a
 * pressed chip. A badge rides out of flow and reaches the option's name as ` · <name>`; the
 * web app's `company-beta.test.ts` covers the beta tag the work-mode switch hangs on it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Segmented } from "../src/components/forms/segmented/segmented";
import { classTokens, renderStatic } from "../src/testing";

const render = (cols?: 2 | 3 | 4 | 5, badge = false) =>
  renderStatic(
    createElement(Segmented<"light" | "dark">, {
      options: [
        { value: "light", label: "Light" },
        {
          value: "dark",
          label: "Dark",
          ...(badge ? { badge: { node: createElement("sup", null, "beta"), name: "Beta" } } : {}),
        },
      ],
      value: "dark",
      onChange: () => {},
      ...(cols !== undefined ? { cols } : {}),
    }),
  );

describe("Segmented", () => {
  it("presses the chosen option and only that one", () => {
    const html = render();
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true" class="[^"]*bg-surface[^"]*">Dark</);
  });

  it("spells its column count as a whole class, for every count it takes", () => {
    for (const cols of [2, 3, 4, 5] as const) {
      expect(classTokens(render(cols))).toContain(`grid-cols-${cols}`);
    }
    expect(classTokens(render())).toContain("grid-cols-3");
  });

  it("sits in a control-shaped well on the rhythm's steps", () => {
    expect(classTokens(render())).toEqual(
      expect.arrayContaining(["rounded-control", "bg-line-muted", "p-1", "gap-1"]),
    );
  });

  it("folds a badge into the option's name and keeps it out of flow", () => {
    const html = render(3, true);
    expect(html).toContain('aria-label="Dark · Beta"');
    expect(html).toMatch(/<span aria-hidden="true" class="absolute[^"]*"><sup>beta<\/sup>/);
    expect(render()).not.toContain("aria-label");
  });
});
