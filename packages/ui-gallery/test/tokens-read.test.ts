import { describe, expect, it } from "vitest";
import {
  matchableSelector,
  sortTokens,
  tokenNamesIn,
  tokensFromRules,
} from "../src/lib/tokens-read";
import type { CssRuleLike } from "../src/lib/tokens-read";

describe("tokens a composition reads", () => {
  it("finds contract names referenced through var(), in contract order, once each", () => {
    expect(
      tokenNamesIn(
        "color: var(--ui-fg-muted); background: var(--ui-canvas); border-color: var( --ui-fg-muted ); --x: var(--ui-not-a-token)",
      ),
    ).toEqual(["--ui-canvas", "--ui-fg-muted"]);
    expect(tokenNamesIn("--ui-canvas: #fff")).toEqual([]);
    expect(sortTokens(["--ui-focus-ring", "--ui-surface", "--ui-accent"])).toEqual([
      "--ui-surface",
      "--ui-accent",
      "--ui-focus-ring",
    ]);
  });

  it("matches a nested rule through its parent, without dynamic states or pseudo-elements", () => {
    expect(matchableSelector(".a:hover", null)).toBe(".a");
    expect(matchableSelector("&:hover", ".hover\\:bg-x")).toBe(":is(.hover\\:bg-x)");
    expect(matchableSelector(".b", ".a")).toBe(":is(.a) .b");
    expect(matchableSelector(".ui-underline-nav [role=tab][aria-selected=true]::after", null)).toBe(
      ".ui-underline-nav [role=tab][aria-selected=true]",
    );
    expect(matchableSelector("button:focus-visible, a:focus-visible", null)).toBe("button, a");
  });

  it("drops what matches everything or nothing", () => {
    expect(matchableSelector("::selection", null)).toBeNull();
    expect(matchableSelector("*", null)).toBeNull();
    expect(matchableSelector(".a, ::selection", null)).toBeNull();
  });
});

describe("the tokens a set of rules gives an element", () => {
  const rule = (selectorText: string, cssText: string, cssRules?: CssRuleLike[]): CssRuleLike => ({
    selectorText,
    style: { cssText },
    ...(cssRules ? { cssRules } : {}),
  });
  /** A probe that accepts the selectors a fake element carries, and throws on a malformed one. */
  const probe = (accepted: string[]) => (selector: string) => {
    // `querySelector` throws on a selector it cannot parse; an unclosed `[` is one.
    if (selector.includes("[") && !selector.includes("]")) throw new SyntaxError(selector);
    return accepted.includes(selector);
  };

  it("collects only from rules that match, in contract order", () => {
    const reading = tokensFromRules(
      [
        [
          rule(".card", "background: var(--ui-canvas)"),
          rule(".elsewhere", "color: var(--ui-fg-muted)"),
          rule(".card", "color: var(--ui-fg); --x: var(--ui-not-a-token)"),
        ],
      ],
      probe([".card"]),
    );
    expect(reading).toEqual({ names: ["--ui-canvas", "--ui-fg"], unreadable: 0 });
  });

  it("reads a nested rule through its parent and an at-rule through the rule around it", () => {
    const atRule: CssRuleLike = { style: { cssText: "color: var(--ui-accent)" } };
    const group: CssRuleLike = { cssRules: [rule(".card", "outline: var(--ui-focus-ring)")] };
    const reading = tokensFromRules(
      [
        [
          rule(".card", "", [rule("&:hover", "background: var(--ui-surface-muted)"), atRule]),
          group,
        ],
      ],
      probe([".card", ":is(.card)"]),
    );
    expect([...reading.names].sort()).toEqual(
      ["--ui-accent", "--ui-focus-ring", "--ui-surface-muted"].sort(),
    );
    expect(reading.unreadable).toBe(0);
  });

  it("counts a selector it cannot read instead of reading it as no match", () => {
    const reading = tokensFromRules(
      [[rule(".a[", "color: var(--ui-fg)"), rule(".card", "background: var(--ui-canvas)")]],
      probe([".card"]),
    );
    expect(reading).toEqual({ names: ["--ui-canvas"], unreadable: 1 });
  });

  it("skips a rule that matches everything, and one with no token in it", () => {
    const reading = tokensFromRules(
      [[rule("*", "color: var(--ui-fg)"), rule(".card", "display: flex")]],
      probe([".card", "*"]),
    );
    expect(reading).toEqual({ names: [], unreadable: 0 });
  });
});
