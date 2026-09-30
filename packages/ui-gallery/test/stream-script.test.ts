/**
 * The streamed-reply script: a seed always cuts a text into the same deltas, the deltas join
 * back into the text exactly, and the rhythm is bursty the way a real stream is — uneven sizes,
 * uneven gaps, stalls among them.
 */
import { describe, expect, it } from "vitest";
import { FIRST_GAP_MS, streamScript, streamTokens } from "../src/app/mock/stream-script";
import type { StreamChunk } from "../src/app/mock/stream-script";
import { streamingAnswer } from "../src/app/mock/transcripts";

const joined = (chunks: readonly StreamChunk[]) => chunks.map((chunk) => chunk.text).join("");

describe("the stream script", () => {
  it("is seeded: the same seed cuts the same script, another seed another", () => {
    for (const lang of ["en", "zh"] as const) {
      const answer = streamingAnswer(lang);
      expect(streamScript(answer, 5)).toEqual(streamScript(answer, 5));
      expect(streamScript(answer, 5)).not.toEqual(streamScript(answer, 6));
    }
  });

  it("joins back into the text exactly, in both languages", () => {
    for (const lang of ["en", "zh"] as const) {
      const answer = streamingAnswer(lang);
      expect(streamTokens(answer).join("")).toBe(answer);
      for (const seed of [1, 2, 3, 5]) expect(joined(streamScript(answer, seed))).toBe(answer);
    }
    // Han text streams a character or two per token; Latin text a word with its space.
    expect(streamTokens("检索分两步 BM25 ok")).toEqual(["检索", "分两", "步 ", "BM25 ", "ok"]);
  });

  it("arrives in bursts: uneven sizes and gaps, with stalls, after the first token's wait", () => {
    const script = streamScript(streamingAnswer("en"), 1);
    expect(script[0]!.gap).toBe(FIRST_GAP_MS);
    const rest = script.slice(1);
    const tokens = script.map((chunk) => streamTokens(chunk.text).length);
    expect(Math.min(...tokens)).toBeLessThanOrEqual(2);
    expect(Math.max(...tokens)).toBeGreaterThanOrEqual(4);
    expect(rest.some((chunk) => chunk.gap < 120)).toBe(true);
    expect(rest.some((chunk) => chunk.gap >= 320)).toBe(true);
  });
});
