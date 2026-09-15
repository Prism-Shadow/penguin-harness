/**
 * The expanded Markdown body the thinking block and the compaction sections share
 * (features/chat/disclosure-row.tsx). vitest is node-only here (`environment: "node"`, no
 * jsdom), so this pins the contract against the source text and styles.css — the
 * title-reveal.test.ts convention.
 *
 * The fragile part is not the class list, it is **where the end-margin reset lives**. The
 * `.md-body` rules in styles.css sit outside any cascade layer while Tailwind's utilities are
 * emitted inside `@layer utilities`, and an unlayered declaration beats a layered one at any
 * specificity — so a `[&>*:first-child]:mt-0` utility on the body is silently inert against
 * `.md-body`'s own `margin: 0.5rem 0`, and the body carries double the inset it claims.
 * Nothing about the class list looks wrong when that happens, which is why it is asserted here.
 *
 * The rest keeps the body in step with the output block it is derived from: the same divider
 * and the same inset, minus the parts that only fit command output, and none of the tinted
 * rounded box the transcript uses for a quotation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DISCLOSURE_BODY_MD_CLASS,
  DISCLOSURE_OUTPUT_PRE_CLASS,
} from "../src/features/chat/disclosure-row";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");

const styles = read("styles.css");
const thinking = read("features/chat/thinking-block.tsx");
const compaction = read("features/chat/compaction-banner.tsx");

/**
 * styles.css with every `@layer …{ }` block removed, i.e. only its unlayered rules.
 * Comments go first: one of them names `@layer utilities` in prose, and the scan below
 * would take that for the start of a block and swallow the rules after it.
 */
const unlayered = (() => {
  let css = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  for (;;) {
    const at = css.search(/@layer[^;{]*\{/);
    if (at === -1) return css;
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    css = css.slice(0, at) + css.slice(end + 1);
  }
})();

/** Class list as a set, so an assertion does not depend on the order Prettier settles on. */
const classes = (value: string) => new Set(value.split(" "));

describe("the disclosure body's end margins", () => {
  it("are reset by an unlayered rule in styles.css", () => {
    expect(classes(DISCLOSURE_BODY_MD_CLASS)).toContain("md-body-flush");
    // Written without whitespace so reformatting the stylesheet cannot break the match.
    const rules = unlayered.replace(/\s+/g, "");
    expect(rules).toContain(".md-body-flush>:first-child{margin-top:0");
    expect(rules).toContain(".md-body-flush>:last-child{margin-bottom:0");
  });

  it("are never reset by a utility, which would lose to .md-body's own margins", () => {
    expect(DISCLOSURE_BODY_MD_CLASS).not.toMatch(/\[&>\*:(first|last)-child\]/);
  });
});

describe("the disclosure body's relation to the output block", () => {
  it("wears the same divider, inset and ink", () => {
    const body = classes(DISCLOSURE_BODY_MD_CLASS);
    const output = classes(DISCLOSURE_OUTPUT_PRE_CLASS);
    for (const shared of [
      "border-t",
      "border-gray-100",
      "dark:border-gray-800",
      "px-3",
      "py-2",
      "text-gray-600",
      "dark:text-gray-300",
    ]) {
      expect(output).toContain(shared);
      expect(body).toContain(shared);
    }
  });

  it("takes neither the height cap nor the raw-text wrapping, which only fit command output", () => {
    // Both bodies stream; a nested scrollbox would strand the tail the transcript follows.
    for (const only of ["max-h-72", "overflow-auto", "whitespace-pre-wrap"]) {
      expect(classes(DISCLOSURE_OUTPUT_PRE_CLASS)).toContain(only);
      expect(classes(DISCLOSURE_BODY_MD_CLASS)).not.toContain(only);
    }
  });

  it("carries no tinted rounded box, the shape the transcript uses for a quotation", () => {
    for (const cls of classes(DISCLOSURE_BODY_MD_CLASS)) {
      expect(cls).not.toMatch(/^(dark:)?(bg|rounded)-/);
      expect(cls).not.toBe("rounded");
    }
  });
});

describe("both expanded bodies", () => {
  it("come from the one shared class, spelled in neither call site", () => {
    for (const source of [thinking, compaction]) {
      expect(source).toContain("DISCLOSURE_BODY_MD_CLASS");
      expect(source).not.toMatch(/className="[^"]*\bmd-body\b/);
    }
  });
});
