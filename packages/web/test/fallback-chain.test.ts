/**
 * Editing the fallback chain: the order IS the meaning (the first entry is tried first), so
 * the moves are pinned here rather than through a rendered card.
 */
import { describe, expect, it } from "vitest";
import {
  addToChain,
  moveInChain,
  removeFromChain,
  sameChainRef,
} from "../src/features/models/fallback-chain";

const a = { provider: "custom", modelId: "m-alpha" };
const b = { provider: "custom", modelId: "m-beta" };
const c = { provider: "openai", modelId: "gpt-6" };

describe("fallbackChain editing", () => {
  it("moves an entry up and down, and leaves the list alone at either end", () => {
    const chain = [a, b, c];
    expect(moveInChain(chain, 1, -1)).toEqual([b, a, c]);
    expect(moveInChain(chain, 1, 1)).toEqual([a, c, b]);
    // Out of range in either direction is a no-op, so the buttons need no bounds checks.
    expect(moveInChain(chain, 0, -1)).toEqual(chain);
    expect(moveInChain(chain, 2, 1)).toEqual(chain);
    // A new array either way: the caller's state is never mutated in place.
    expect(moveInChain(chain, 0, 1)).not.toBe(chain);
  });

  it("appends a model once, and never the same model twice", () => {
    expect(addToChain([a], b)).toEqual([a, b]);
    // The same pair by value, not identity: a chain lists each model once.
    expect(addToChain([a], { provider: "custom", modelId: "m-alpha" })).toEqual([a]);
    // The same model id under another provider is a different model.
    expect(
      addToChain([{ provider: "openai", modelId: "gpt-6" }], {
        provider: "azure",
        modelId: "gpt-6",
      }),
    ).toEqual([
      { provider: "openai", modelId: "gpt-6" },
      { provider: "azure", modelId: "gpt-6" },
    ]);
  });

  it("removes by position, not by value", () => {
    expect(removeFromChain([a, b, c], 1)).toEqual([a, c]);
    expect(removeFromChain([a], 0)).toEqual([]);
  });

  it("compares references by their pair", () => {
    expect(sameChainRef(a, { provider: "custom", modelId: "m-alpha" })).toBe(true);
    expect(sameChainRef(a, b)).toBe(false);
  });
});
