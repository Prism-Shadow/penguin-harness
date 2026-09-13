/**
 * The panel's explanation of an empty source half (`features/workbench/source-tier.ts`, M4.3 / AC-5
 * and M4.5 / AC-4).
 *
 * What is under test is the *decision*, not the copy: four situations all end at `confidence: "none"`,
 * and the whole point of this module is that they are told apart — a page with no map at all suggests
 * a different next move from an element that only exists inside a library's runtime, and an
 * unsupported framework suggests a third. The priority between them is the contract, so every
 * overlap is pinned here: the page-wide fact wins over the element's particulars, because it is the
 * one that is true of every element on that page.
 *
 * The other half — that every reason and every tier actually has a line in both languages — is
 * pinned here too, because a missing key would otherwise be a runtime `undefined` in the panel.
 */
import { describe, expect, it } from "vitest";
import { explainSourceGap, sourceRowText } from "../src/features/workbench/source-tier";
import type { SourceGapReason } from "../src/features/workbench/source-tier";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const gap = (
  confidence: "exact" | "file-only" | "ambiguous" | "none",
  options: {
    moduleIsThirdParty?: boolean;
    hasEvidence?: boolean;
    pageSourceMap?: "present" | "none" | "unknown";
  } = {},
): SourceGapReason | null =>
  explainSourceGap({
    source: {
      confidence,
      ...(options.moduleIsThirdParty === undefined
        ? {}
        : { moduleIsThirdParty: options.moduleIsThirdParty }),
    },
    hasEvidence: options.hasEvidence ?? true,
    pageSourceMap: options.pageSourceMap ?? "present",
  });

describe("explainSourceGap", () => {
  it("explains nothing when the element was located, in any of the three located tiers", () => {
    expect(gap("exact")).toBeNull();
    expect(gap("file-only")).toBeNull();
    expect(gap("ambiguous")).toBeNull();
  });

  it("blames the page before the element when no map can be read on it (AC-5)", () => {
    // A production build: the probe read the page's entry module and found no map, the framework
    // reported nothing, and no element on this page can resolve — which is the page-wide answer.
    expect(gap("none", { pageSourceMap: "none", hasEvidence: false })).toBe("page-no-map");
    // Even when the element's own particulars would say something else: every pick on this page has
    // the same problem, so naming the page is the honest answer rather than the closest cause.
    expect(gap("none", { pageSourceMap: "none", hasEvidence: true })).toBe("page-no-map");
    expect(gap("none", { pageSourceMap: "none", moduleIsThirdParty: true })).toBe("page-no-map");
  });

  it("names the runtime when the element's creator lives in framework or library code", () => {
    // A page that does carry a map, and a stack with nothing but React's own runtime in it.
    expect(gap("none", { moduleIsThirdParty: true, hasEvidence: true })).toBe("dependency-runtime");
    // React 18's route: the component's module is a dependency, so there is nothing of the user's to
    // point at even though evidence existed.
    expect(
      gap("none", { moduleIsThirdParty: true, hasEvidence: true, pageSourceMap: "unknown" }),
    ).toBe("dependency-runtime");
  });

  it("says the framework reported nothing when there was no evidence at all (§9.4)", () => {
    expect(gap("none", { hasEvidence: false })).toBe("no-evidence");
    // An unread entry module ("unknown") is not the same fact as a page proven to have no map: the
    // tier cannot be judged, so the framework's silence is what is left to report.
    expect(gap("none", { hasEvidence: false, pageSourceMap: "unknown" })).toBe("no-evidence");
  });

  it("says the resolution itself came up short when evidence did not survive the map", () => {
    expect(gap("none", { hasEvidence: true })).toBe("unresolved");
    expect(gap("none", { hasEvidence: true, moduleIsThirdParty: false })).toBe("unresolved");
  });
});

describe("the source row", () => {
  const row = (
    source: Parameters<typeof sourceRowText>[0],
    state: { pending: boolean; gap: SourceGapReason | null } = { pending: false, gap: null },
  ) => sourceRowText(source, state);

  it("shows the located position and its tier in words, one per tier", () => {
    expect(row({ file: "src/App.jsx", line: 7, column: 7, confidence: "exact" })).toBe(
      "精确 src/App.jsx:7:7",
    );
    expect(row({ file: "src/App.vue", confidence: "file-only" })).toBe(
      "只到文件 src/App.vue（这个框架只说得出文件，不编行号）",
    );
    expect(
      row({ file: "src/Rows.jsx", line: 5, column: 9, confidence: "ambiguous", candidates: 2 }),
    ).toBe("有歧义 src/Rows.jsx:5:9（同一处写法有 2 个候选，可能是兄弟节点）");
  });

  it("says why when there is no location, and never just 'none'", () => {
    const none = row({ confidence: "none" }, { pending: false, gap: "page-no-map" });
    expect(none).toContain("无源码位置");
    expect(none).toContain("sourcemap");
    // Every reason has its own line: two situations must not read the same.
    const lines = new Set(
      (["page-no-map", "dependency-runtime", "no-evidence", "unresolved"] as SourceGapReason[]).map(
        (gap) => row({ confidence: "none" }, { pending: false, gap }),
      ),
    );
    expect(lines.size).toBe(4);
  });

  it("does not claim 'no location' while the resolution is still running", () => {
    // The pick has arrived and the answer has not: the row must say it is working, not that the
    // page has nothing.
    const pending = row({ confidence: "none" }, { pending: true, gap: "page-no-map" });
    expect(pending).toBe(zh.workbench.sourceTier.locating);
    expect(pending).not.toContain("无源码位置");
  });

  it("keeps the location and adds whose file it is when it lands in a dependency (§9.4)", () => {
    // The React-19 route that m33 measured: the `<h1>` react-markdown built for itself, located in the
    // library's own file. The row must still say *where* — the location is the honest answer — and add
    // that editing it changes nothing, which is the whole of §9.4's third row.
    const library = row({
      file: "node_modules/hast-util-to-jsx-runtime/lib/index.js",
      line: 381,
      column: 10,
      confidence: "exact",
      moduleIsThirdParty: true,
    });
    expect(library).toContain("精确 node_modules/hast-util-to-jsx-runtime/lib/index.js:381:10");
    expect(library).toContain("库内部");
    // And the mark travels with every located tier, not just `exact`.
    expect(
      row({ file: "node_modules/x/y.vue", confidence: "file-only", moduleIsThirdParty: true }),
    ).toContain("库内部");
    expect(
      row({
        file: "node_modules/x/y.jsx",
        line: 5,
        column: 9,
        confidence: "ambiguous",
        candidates: 2,
        moduleIsThirdParty: true,
      }),
    ).toContain("库内部");
  });

  it("leaves an element of the user's own project unmarked", () => {
    const own = row({ file: "src/App.jsx", line: 7, column: 7, confidence: "exact" });
    expect(own).toBe("精确 src/App.jsx:7:7");
    // `false` is not "unknown": a dependency's *runtime* that is not the file's own family is not the
    // case this mark is for, and the word must not appear where it would be wrong.
    expect(
      row({
        file: "src/App.jsx",
        line: 7,
        column: 7,
        confidence: "exact",
        moduleIsThirdParty: false,
      }),
    ).toBe("精确 src/App.jsx:7:7");
  });

  it("does not add the mark to a 'no location' row — its reason already names the library", () => {
    const none = row(
      { confidence: "none", moduleIsThirdParty: true },
      { pending: false, gap: "dependency-runtime" },
    );
    expect(none).toBe(zh.workbench.sourceTier.none["dependency-runtime"]);
    expect(none).not.toContain(zh.workbench.sourceTier.thirdParty);
  });
});

describe("the source row's copy", () => {
  const dictionaries = { zh, en };
  const reasons: SourceGapReason[] = [
    "page-no-map",
    "dependency-runtime",
    "no-evidence",
    "unresolved",
  ];

  for (const [locale, dict] of Object.entries(dictionaries)) {
    it(`${locale} has one line per reason, and none of them is empty`, () => {
      const none = dict.workbench.sourceTier.none;
      expect(Object.keys(none).sort()).toEqual([...reasons].sort());
      for (const reason of reasons) expect(none[reason].trim().length).toBeGreaterThan(0);
    });

    it(`${locale} states all four tiers, with the file in the located ones`, () => {
      const tier = dict.workbench.sourceTier;
      expect(tier.locating.trim().length).toBeGreaterThan(0);
      // The two lines a located element shows must carry the position the payload resolved, or the
      // row would have stopped saying where the element is.
      expect(tier.exact("src/App.jsx:7:7")).toContain("src/App.jsx:7:7");
      expect(tier.fileOnly("src/App.vue")).toContain("src/App.vue");
      expect(tier.ambiguous("src/Rows.jsx:5:9", 2)).toContain("src/Rows.jsx:5:9");
      expect(tier.ambiguous("src/Rows.jsx:5:9", 2)).toContain("2");
      // §9.4's fourth row: an element located inside a dependency is marked in both languages.
      expect(tier.thirdParty.trim().length).toBeGreaterThan(0);
    });
  }
});
