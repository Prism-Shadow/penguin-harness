/**
 * MetaLine (src/components/data/meta-line/meta-line.tsx): a thing's facts on one line, a middle
 * dot between each.
 *
 * - Given three facts, they read in order with one dot between each and none at either end.
 * - Given facts that are absent (null, undefined, false), they leave no dot behind.
 * - Given one fact, the line holds it alone, with no dot.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MetaLine } from "../src/components/data/meta-line/meta-line";
import { renderStatic } from "../src/testing";

/** The line as a reader sees it: tags dropped, the words and dots left. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const line = (...items: unknown[]) =>
  renderStatic(createElement(MetaLine, null, ...(items as never[])));

describe("MetaLine", () => {
  it("reads its facts in order, one dot between each and none at the ends", () => {
    const html = line(
      createElement("span", null, "v0.2.13"),
      createElement("span", null, "Installed"),
      createElement("span", null, "used by 2 agents"),
    );
    expect(words(html)).toBe("v0.2.13 · Installed · used by 2 agents");
    // The dots are spacing, not words: hidden from assistive technology.
    expect(html.match(/<span aria-hidden="true"[^>]*>·<\/span>/g)).toHaveLength(2);
  });

  it("leaves no dot behind for a fact that is absent", () => {
    const html = line(
      null,
      createElement("span", null, "Installed"),
      false,
      undefined,
      createElement("span", null, "used by 2 agents"),
    );
    expect(words(html)).toBe("Installed · used by 2 agents");
  });

  it("holds a single fact alone", () => {
    expect(words(line(createElement("span", null, "v0.2.13")))).toBe("v0.2.13");
  });
});
