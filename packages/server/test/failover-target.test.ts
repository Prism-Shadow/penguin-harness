/**
 * Where a rate-limited Session runs next: the Project's fallback chain, read as an order.
 *
 * The decision is what keeps failover from cycling — an entry the Session is already on, or
 * one it has already been moved onto, is skipped rather than retried — so the boundaries are
 * pinned here rather than through a whole run.
 */
import { describe, expect, it } from "vitest";
import { isFailoverEligibleEnd, nextFailoverTarget } from "../src/runtime/session-manager.js";

const ref = (provider: string, modelId: string) => ({ provider, modelId });
const chain = [ref("deepseek", "deepseek-flash"), ref("anthropic", "claude-sonnet-4-6")];

describe("nextFailoverTarget", () => {
  it("takes the first entry that is neither the current model nor one already tried", () => {
    expect(nextFailoverTarget(chain, ref("openai", "gpt-6"), new Set())).toEqual(chain[0]);
    // The first entry is the model already running: the next one answers.
    expect(nextFailoverTarget(chain, chain[0]!, new Set())).toEqual(chain[1]);
  });

  it("skips what this Session has already been moved onto, so a chain cannot cycle", () => {
    const tried = new Set(["deepseek/deepseek-flash"]);
    expect(nextFailoverTarget(chain, ref("openai", "gpt-6"), tried)).toEqual(chain[1]);
    // Every entry tried (or current): there is nowhere left, and the turn ends as it always has.
    expect(
      nextFailoverTarget(
        chain,
        ref("openai", "gpt-6"),
        new Set(["deepseek/deepseek-flash", "anthropic/claude-sonnet-4-6"]),
      ),
    ).toBeUndefined();
  });

  it("answers undefined for an unset or empty chain: no chain, no failover", () => {
    expect(nextFailoverTarget([], ref("deepseek", "deepseek-flash"), new Set())).toBeUndefined();
    // A chain holding only the current model has nowhere to move it.
    expect(nextFailoverTarget([chain[0]!], chain[0]!, new Set())).toBeUndefined();
  });

  it("tells the same model id apart across providers", () => {
    const same = [ref("openai", "gpt-6"), ref("azure", "gpt-6")];
    expect(nextFailoverTarget(same, ref("openai", "gpt-6"), new Set())).toEqual(
      ref("azure", "gpt-6"),
    );
    expect(
      nextFailoverTarget(same, ref("openai", "gpt-6"), new Set(["azure/gpt-6"])),
    ).toBeUndefined();
  });
});

describe("isFailoverEligibleEnd", () => {
  it("moves on transport failures: a 429, or a ladder the retries did not recover", () => {
    for (const code of ["rate_limited", "timeout", "network", "connect_failed"]) {
      expect(isFailoverEligibleEnd(code)).toBe(true);
    }
  });

  it("stays on successes and refused requests: moving changes nothing for them", () => {
    expect(isFailoverEligibleEnd(undefined)).toBe(false);
    for (const code of ["auth", "rejected", "unsupported", "image_rejected", "malformed"]) {
      expect(isFailoverEligibleEnd(code)).toBe(false);
    }
  });
});
