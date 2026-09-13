/**
 * The workbench's support matrix (`S.workbench.support`, PRD §9.4) is a **claim about what has been
 * measured**, so it is pinned here rather than left as prose. Two things can go wrong with it and
 * both are silent: a framework nobody measured gets added to a row (the panel then promises something
 * it cannot do), or the two dictionaries drift apart (an English reader reads a different promise than
 * a Chinese one). The rows themselves come from the real-machine runs — React 19 / React 18 /
 * Svelte 5 exact and Vue 3 file-only in m34 (D18), production builds degraded in m43 (D20) — and the
 * tier each framework lands in is what this test holds still.
 */
import { describe, expect, it } from "vitest";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** The frameworks each tier was measured on. Adding one here means running the tier against it. */
const EXACT = ["React 19", "React 18", "Svelte 5"];
const FILE_ONLY = ["Vue 3"];
/** Every name above, so a row cannot name one of them as a counter-example to itself. */
const MEASURED = [...EXACT, ...FILE_ONLY];

describe("workbench support matrix", () => {
  const dictionaries = { zh: zh.workbench.support, en: en.workbench.support };

  it("is the same shape in both dictionaries — an English reader gets the same promise", () => {
    expect(Object.keys(en.workbench.support)).toEqual(Object.keys(zh.workbench.support));
    for (const matrix of Object.values(dictionaries)) {
      for (const [row, text] of Object.entries(matrix)) {
        // `boundaries` is a block of its own, pinned in the suite below; the rows here are strings.
        if (typeof text !== "string") continue;
        expect(text.trim(), `${row} is empty`).not.toBe("");
      }
    }
  });

  it("claims exactly the frameworks measured as exact, and none besides", () => {
    for (const [locale, matrix] of Object.entries(dictionaries)) {
      for (const name of EXACT) expect(matrix.exact, `${locale}: exact row`).toContain(name);
      // Vue 3 lands in `file-only` and React/Svelte do not: a row that names the other tier's
      // frameworks would be the panel telling a user the opposite of what m34 measured.
      for (const name of FILE_ONLY)
        expect(matrix.exact, `${locale}: exact row`).not.toContain(name);
    }
  });

  it("puts Vue 3 in file-only and keeps the exact-tier frameworks out of it", () => {
    for (const [locale, matrix] of Object.entries(dictionaries)) {
      for (const name of FILE_ONLY)
        expect(matrix.fileOnly, `${locale}: file-only row`).toContain(name);
      for (const name of EXACT)
        expect(matrix.fileOnly, `${locale}: file-only row`).not.toContain(name);
    }
  });

  it("keeps the dev-server gate in the standing line — a production build can never be located", () => {
    // PRD §9.4's last row: production builds are unsupported by construction, which is the one limit
    // a user has to know *before* pointing the panel at anything.
    expect(zh.workbench.support.line).toContain("dev server");
    expect(en.workbench.support.line).toMatch(/dev server/i);
  });

  it("names no framework outside the measured set in the rows that place a tier", () => {
    // `degraded` names webpack / Next.js on purpose (they are the unmeasured ones); the two rows that
    // *place* a framework must only ever name a framework a run has placed.
    for (const [locale, matrix] of Object.entries(dictionaries)) {
      const placed = [matrix.exact, matrix.fileOnly].join(" ");
      for (const name of ["Webpack", "webpack", "Next.js", "Nuxt", "Angular", "Solid", "Preact"]) {
        expect(placed, `${locale}: unmeasured framework placed in a tier`).not.toContain(name);
      }
      // And the measured set is accounted for exactly once between the two rows.
      for (const name of MEASURED) {
        const count = [matrix.exact, matrix.fileOnly].filter((row) => row.includes(name)).length;
        expect(count, `${locale}: ${name} placed in ${count} rows`).toBe(1);
      }
    }
  });
});

/**
 * The four limits under the matrix (M5.4, D30). The matrix answers "which frameworks work"; these
 * answer "what the location I get actually means, and who can put one in front of me". Both are the
 * panel telling the truth before it is trusted with anything, and both are pinned for the same
 * reason: they are the sentences most likely to be quietly softened by a later edit.
 */
describe("workbench boundary copy", () => {
  const both = [zh.workbench.support.boundaries, en.workbench.support.boundaries];

  it("carries the same four limits, in both dictionaries, none of them empty", () => {
    expect(Object.keys(en.workbench.support.boundaries.rows)).toEqual([
      "jsx",
      "styles",
      "ambiguous",
      "channel",
    ]);
    expect(Object.keys(en.workbench.support.boundaries.rows)).toEqual(
      Object.keys(zh.workbench.support.boundaries.rows),
    );
    for (const boundaries of both) {
      expect(boundaries.lead.trim()).not.toBe("");
      for (const [row, text] of Object.entries(boundaries.rows)) {
        expect(text.trim(), `${row} is empty`).not.toBe("");
      }
    }
  });

  it("names the unauthenticated channel instead of only the page's own limits", () => {
    // Q6 was decided as "keep the console channel and say what it costs" (D30) — the copy has to
    // carry it, or the decision exists only in the decision log.
    for (const boundaries of both) {
      expect(boundaries.rows.channel).toContain("console");
    }
    expect(zh.workbench.support.boundaries.rows.channel).toContain("伪造");
    expect(en.workbench.support.boundaries.rows.channel).toMatch(/forge/i);
  });

  it("keeps the three measured reading habits: JSX not CSS, stylesheet short-circuit, wrapping element", () => {
    // m53 (D23): agents may land a style change in the stylesheet — the page is still right.
    expect(zh.workbench.support.boundaries.rows.styles).toContain("样式表");
    expect(en.workbench.support.boundaries.rows.styles).toMatch(/stylesheet/i);
    // m51 (D22): 24 of 33 `ambiguous` picks landed on the element wrapping the target.
    expect(zh.workbench.support.boundaries.rows.ambiguous).toContain("包着");
    expect(en.workbench.support.boundaries.rows.ambiguous).toMatch(/wrapping/i);
    expect(zh.workbench.support.boundaries.rows.jsx).toContain("JSX");
    expect(en.workbench.support.boundaries.rows.jsx).toContain("JSX");
  });
});
