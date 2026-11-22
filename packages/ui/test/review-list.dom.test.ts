// @vitest-environment jsdom
/**
 * The review list (src/components/data/review-list): groups of one-line rows to choose from
 * before a removal, the choice held by the caller.
 *
 * - Given two groups, Select all on one chooses that group's rows that can be chosen — never a
 *   disabled one — and leaves the other group's choice as it was.
 * - Given every row of a group that can be chosen chosen, its header offers Deselect all, which
 *   unchooses that group's rows only.
 * - Given a row pressed anywhere on its line, it is chosen; pressed again, it is not.
 * - Given a row that cannot be chosen, its box is disabled, says why on hover, and pressing the
 *   line changes nothing.
 * - Given a group with no rows, it is not drawn.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h, useState } from "react";
import { ReviewList } from "../src/components/data/review-list/review-list";
import type { ReviewGroup, ReviewListLabels } from "../src/components/data/review-list/review-list";
import { fire, mount, unmountAll } from "./helpers/dom";

const LABELS: ReviewListLabels = {
  selectAll: "Select all",
  deselectAll: "Deselect all",
  count: (n) => `${n} items`,
  select: (title) => `Select ${title}`,
};

const GROUPS: ReviewGroup[] = [
  {
    key: "scratch",
    label: "Scratchpads",
    note: "Their attachments stop showing.",
    total: "1.5 GB",
    items: [
      { key: "s1", title: "Quarterly report", meta: "Docs › writer", time: "3d", value: "1.0 GB" },
      { key: "s2", title: "Release plan", meta: "Docs › writer", time: "5d", value: "0.5 GB" },
      {
        key: "s3",
        title: "Live run",
        value: "0.1 GB",
        disabled: true,
        disabledReason: "Running",
      },
    ],
  },
  {
    key: "caches",
    label: "Agent caches",
    items: [{ key: "c1", title: "node", value: "300 MB" }],
  },
  { key: "empty", label: "Server caches", items: [] },
];

/** The list under its caller, who keeps the choice and reports every change. */
async function render(initial: string[] = []) {
  const seen: string[][] = [];
  function Host() {
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial));
    return h(ReviewList, {
      groups: GROUPS,
      selected,
      labels: LABELS,
      onChange: (next: Set<string>) => {
        seen.push([...next].sort());
        setSelected(next);
      },
    });
  }
  const { container } = await mount(h(Host));
  return { container, seen };
}

const sectionOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("section")].find(
    (s) => s.querySelector("h3")?.textContent === label,
  )!;

const buttonIn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;

const box = (container: HTMLElement, title: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="Select ${title}"]`)!;

const press = (el: Element) => fire(el, new MouseEvent("click", { bubbles: true }));

afterEach(unmountAll);

describe("ReviewList", () => {
  it("chooses only a group's rows that can be chosen on Select all, and leaves the others", async () => {
    const { container, seen } = await render(["c1"]);
    await press(buttonIn(sectionOf(container, "Scratchpads"), "Select all"));
    expect(seen.at(-1)).toEqual(["c1", "s1", "s2"]);
    expect(box(container, "Live run").checked).toBe(false);
  });

  it("offers Deselect all once a group is all chosen, and unchooses that group alone", async () => {
    const { container, seen } = await render(["s1", "s2", "c1"]);
    const scratch = sectionOf(container, "Scratchpads");
    await press(buttonIn(scratch, "Deselect all"));
    expect(seen.at(-1)).toEqual(["c1"]);
    expect(buttonIn(scratch, "Select all")).toBeDefined();
  });

  it("toggles a row pressed anywhere on its line", async () => {
    const { container, seen } = await render();
    const line = box(container, "Quarterly report").closest("label")!;
    await press(line.querySelector("span.truncate")!);
    expect(seen.at(-1)).toEqual(["s1"]);
    await press(line);
    expect(seen.at(-1)).toEqual([]);
  });

  it("disables a row that cannot be chosen, says why on hover, and ignores a press", async () => {
    const { container, seen } = await render();
    const input = box(container, "Live run");
    expect(input.disabled).toBe(true);
    expect(input.closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe("Running");
    await press(input.closest("label")!);
    expect(seen).toEqual([]);
  });

  it("draws no group that has no rows", async () => {
    const { container } = await render();
    expect([...container.querySelectorAll("h3")].map((x) => x.textContent)).toEqual([
      "Scratchpads",
      "Agent caches",
    ]);
  });
});
