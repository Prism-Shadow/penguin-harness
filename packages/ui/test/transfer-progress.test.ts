/**
 * The transfer row (src/components/feedback/transfer-progress/), as it first renders.
 *
 * - Given a reading, the row says its sentence, shows the caller's amount as written (the padding
 *   that holds its width included), and exposes a progress bar with that value and maximum, named
 *   by the sentence.
 * - Given nothing counted yet, no amount shows and the bar is indeterminate: it states a maximum
 *   but no value, so it reads as busy rather than as zero done.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TransferProgress } from "../src/components/feedback/transfer-progress/transfer-progress";
import type { TransferProgressProps } from "../src/components/feedback/transfer-progress/transfer-progress";
import { renderStatic } from "../src/testing";

const render = (props: TransferProgressProps) =>
  renderStatic(createElement(TransferProgress, props));
/** The attributes of the progress bar, by name. */
const bar = (html: string): Record<string, string> => {
  const tag = /<div[^>]*role="progressbar"[^>]*>/.exec(html)?.[0] ?? "";
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
};

describe("the transfer row", () => {
  it("says what comes over, shows the amount as given, and exposes the reading on its bar", () => {
    const html = render({
      label: "Loading the latest messages from gpu-box",
      amount: "  2 / 380 KB",
      value: 2_048,
      max: 389_120,
    });
    expect(html).toContain("Loading the latest messages from gpu-box");
    expect(html).toContain("  2 / 380 KB");
    expect(bar(html)).toMatchObject({
      "aria-label": "Loading the latest messages from gpu-box",
      "aria-valuenow": "2048",
      "aria-valuemax": "389120",
    });
  });

  it("before anything is counted shows no amount and a bar with no value", () => {
    const html = render({ label: "Loading the latest messages from gpu-box" });
    expect(html).not.toContain(" / ");
    const attributes = bar(html);
    expect(attributes["aria-label"]).toBe("Loading the latest messages from gpu-box");
    expect(attributes).not.toHaveProperty("aria-valuenow");
  });
});
