import { describe, expect, it } from "vitest";
import { matchableSelector, sortTokens, tokenNamesIn } from "../src/lib/tokens-read";

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
