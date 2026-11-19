import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFile, scanSourceRoots, type JsxElementInfo, type SourceFile } from "../src/testing";
import { REPO_ROOT, SRC_DIR, WEB_DIR } from "./helpers/paths";

/** Only inspect full-size decorative layers. A centred, explicitly sized mark has its own shape. */
function uncontainedPaint(element: JsxElementInfo): boolean {
  const base = element.classes
    .filter((token) => !token.variants.length)
    .map((token) => token.utility);
  if (!["absolute", "inset-0", "pointer-events-none"].every((utility) => base.includes(utility)))
    return false;
  if (base.some((utility) => /^(size|w|h)-/.test(utility) && !/-(full|auto)$/.test(utility)))
    return false;
  const paints = element.classes.filter(
    ({ utility }) =>
      utility === "ring-inset" || (utility.startsWith("bg-") && utility !== "bg-transparent"),
  );
  if (!paints.length) return false;

  for (let parent = element.parent; parent; parent = parent.parent) {
    if (
      parent.attributes.has("data-clip-surface") ||
      (parent.tag === "Card" && parent.attributes.get("padding") === "none")
    )
      return false;
    if (
      parent.classes.some(
        ({ utility, variants }) =>
          !variants.length && ["overflow-hidden", "overflow-clip"].includes(utility),
      )
    )
      return false;
  }

  // A radius on hover cannot contain a background painted at rest. A matching state-specific
  // shape is enough for a state-specific fill. An explicit shape may belong to the overlay.
  const radii = element.classes.filter(
    ({ utility }) =>
      /^(rounded(?:$|-)|\[border-radius:)/.test(utility) && utility !== "rounded-none",
  );
  return paints.some(
    (paint) =>
      !radii.some((radius) => radius.variants.every((variant) => paint.variants.includes(variant))),
  );
}

function violations(file: SourceFile) {
  return analyzeFile(file)
    .elements.filter(uncontainedPaint)
    .map((el) => file.id + ":" + el.line);
}

describe("edge-to-edge decorative paint", () => {
  it("follows the target's corners or is inside its closed surface", () => {
    const scan = scanSourceRoots(
      { ui: join(SRC_DIR, "components"), web: join(WEB_DIR, "src") },
      { repoRoot: REPO_ROOT, extensions: [".tsx"] },
    );
    expect(scan.files.flatMap(violations)).toEqual([]);
  });
  it("detects a square wash and accepts a closed target, an inherited shape and an inset mark", () => {
    const overlay = "absolute inset-0 pointer-events-none bg-surface";
    const faults = (tsx: string) =>
      violations({
        root: "ui",
        rel: "probe.tsx",
        id: "probe.tsx",
        path: "probe.tsx",
        name: "probe.tsx",
        text: "const Test = () => (" + tsx + ");",
      });
    expect(faults(`<span className="${overlay}" />`)).toHaveLength(1);
    expect(faults(`<span className="${overlay} hover:rounded-[inherit]" />`)).toHaveLength(1);
    expect(
      faults(`<Card padding="none"><div><span className="${overlay}" /></div></Card>`),
    ).toEqual([]);
    expect(faults(`<span className="${overlay} rounded-full" />`)).toEqual([]);
    expect(
      faults(
        '<span className="absolute inset-0 pointer-events-none hover:bg-accent hover:rounded-md" />',
      ),
    ).toEqual([]);
    expect(faults(`<div data-clip-surface=""><span className="${overlay}" /></div>`)).toEqual([]);
    expect(faults(`<span className="${overlay} rounded-[inherit]" />`)).toEqual([]);
    expect(faults(`<span className="${overlay} m-auto size-2 rounded-full" />`)).toEqual([]);
  });
});
